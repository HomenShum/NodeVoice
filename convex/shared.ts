/** Shared, side-effect-free definitions used by both mutations and actions. */

export type Slot = "a" | "b";

export interface AgentDef {
  slot: Slot;
  name: string;
  device: "laptop" | "phone";
  openaiVoice: string;
  persona: string;
}

export const AGENTS: Record<Slot, AgentDef> = {
  a: {
    slot: "a",
    name: "Ada",
    device: "laptop",
    openaiVoice: "nova",
    persona: "A decisive planner. Proposes concrete, specific options with names and rough timing, and pushes to lock decisions.",
  },
  b: {
    slot: "b",
    name: "Ben",
    device: "phone",
    openaiVoice: "onyx",
    persona: "A thoughtful challenger. Asks one sharp question, checks constraints and budget, then refines the plan.",
  },
};

export const DEFAULT_GOAL =
  "Plan a great Saturday for two friends in San Francisco and agree on a final 3-stop itinerary with rough timing.";

export const ROUTER_MODELS = [
  { id: "gpt-5.4-mini", label: "GPT-5.4 mini", tier: "smart + fast", note: "default · smartest mini that stays ~1.3s" },
  { id: "gpt-4.1-nano", label: "GPT-4.1 nano", tier: "cheapest", note: "fastest (~0.7s) + cheapest" },
  { id: "gpt-4.1-mini", label: "GPT-4.1 mini", tier: "balanced", note: "fast, mid capability" },
  { id: "gpt-4o-mini", label: "GPT-4o mini", tier: "legacy", note: "older baseline" },
  { id: "gpt-5-nano", label: "GPT-5 nano", tier: "cheap + smart", note: "smart but ~3s (reasoning)" },
  { id: "gpt-5-mini", label: "GPT-5 mini", tier: "max quality", note: "top quality, ~3s+ (reasoning)" },
] as const;

export const DEFAULT_MODEL = "gpt-5.4-mini";

export function validModel(m?: string): string {
  return m && ROUTER_MODELS.some((x) => x.id === m) ? m : DEFAULT_MODEL;
}

export const other = (slot: Slot): Slot => (slot === "a" ? "b" : "a");

/** Short human-typeable join code — unambiguous alphabet (no 0/O/1/l/i). */
const CODE_ALPHABET = "23456789abcdefghjkmnpqrstuvwxyz";
export function makeRoomCode(): string {
  let code = "";
  for (let i = 0; i < 6; i += 1) code += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
  return code;
}

/** Rough speech duration so the scheduler paces turns to ~audio length. */
export function estimateSpeechMs(text: string): number {
  return Math.min(11_000, 1400 + text.length * 55);
}

export interface CountTask {
  kind: "count_to_n";
  target: number;
  next: number;
}

export interface CountTurnLike {
  text: string;
  speechAct: "task_action" | "backchannel" | "question";
  done: boolean;
}

const MAX_COUNT_TARGET = 300;
const SMALL_NUMBERS: Record<string, number> = {
  a: 1,
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
  thirteen: 13,
  fourteen: 14,
  fifteen: 15,
  sixteen: 16,
  seventeen: 17,
  eighteen: 18,
  nineteen: 19,
};
const TENS_NUMBERS: Record<string, number> = {
  twenty: 20,
  thirty: 30,
  forty: 40,
  fifty: 50,
  sixty: 60,
  seventy: 70,
  eighty: 80,
  ninety: 90,
};

export function deriveGoalOverrideFromHuman(text: string): string | null {
  const countTarget = extractCountTarget(text);
  if (countTarget !== null) return buildCountGoal(countTarget);

  const trimmed = text.trim();
  const explicit = trimmed.match(
    /^(?:new\s+goal|change\s+(?:the\s+)?goal|set\s+(?:the\s+)?goal|switch\s+(?:the\s+)?(?:goal|task)|replace\s+(?:the\s+)?(?:goal|task))(?:\s+(?:to|as))?\s*[:,-]?\s*(.+)$/i,
  );
  if (explicit?.[1]) return cleanGoal(explicit[1]);

  const correction = trimmed.match(/^(?:actually|instead)\s*[,:-]?\s*(?:let'?s\s+)?(.+)$/i);
  if (correction?.[1] && looksLikeTask(correction[1])) return cleanGoal(correction[1]);

  return null;
}

export function deriveCountTask(goal: string, next = 1): CountTask | null {
  const target = extractCountTarget(goal);
  if (target === null) return null;
  return { kind: "count_to_n", target, next: clampInt(next, 1, target) };
}

export function buildCountGoal(target: number): string {
  return `Count from 1 to ${target} out loud, one number per agent turn, stopping exactly at ${target}.`;
}

export function coerceCountTurn<T extends CountTurnLike>(turn: T, task: CountTask): T {
  const spoken = parseNumberPhrase(turn.text);
  const terse = turn.text.trim().split(/\s+/).filter(Boolean).length <= 4;
  const text = spoken === task.next && terse ? turn.text.trim() : numberToWords(task.next);
  return {
    ...turn,
    text,
    speechAct: "task_action",
    done: task.next >= task.target,
  };
}

function extractCountTarget(text: string): number | null {
  const normalized = normalizeNumberText(text);
  const match = normalized.match(/\bcount(?:ing)?(?:\s+up)?(?:\s+out\s+loud)?(?:\s+from\s+[\w\s-]+?)?\s+(?:to|through|until)\s+([\w\s-]+)/i);
  if (!match?.[1]) return null;
  const target = parseNumberPhrase(match[1]);
  return target !== null && target > 0 && target <= MAX_COUNT_TARGET ? target : null;
}

function parseNumberPhrase(text: string): number | null {
  const normalized = normalizeNumberText(text);
  const digit = normalized.match(/\b(\d{1,3})\b/);
  if (digit?.[1]) return Number(digit[1]);

  const tokens = normalized.split(/\s+/).filter(Boolean);
  let total = 0;
  let current = 0;
  let sawNumber = false;

  for (const token of tokens) {
    if (SMALL_NUMBERS[token] !== undefined) {
      current += SMALL_NUMBERS[token];
      sawNumber = true;
    } else if (TENS_NUMBERS[token] !== undefined) {
      current += TENS_NUMBERS[token];
      sawNumber = true;
    } else if (token === "hundred") {
      total += (current || 1) * 100;
      current = 0;
      sawNumber = true;
    } else if (token === "and") {
      continue;
    } else if (sawNumber) {
      break;
    }
  }

  const value = total + current;
  return sawNumber && value > 0 ? value : null;
}

function numberToWords(n: number): string {
  const small = Object.entries(SMALL_NUMBERS).find(([key, value]) => key !== "a" && value === n);
  if (small) return capitalize(small[0]);
  const tens = Object.entries(TENS_NUMBERS).sort((a, b) => b[1] - a[1]);
  for (const [word, value] of tens) {
    if (n === value) return capitalize(word);
    if (n > value && n < value + 10) {
      const ones = Object.entries(SMALL_NUMBERS).find(([key, smallValue]) => key !== "a" && smallValue === n - value)?.[0];
      if (ones) return `${capitalize(word)}-${ones}`;
    }
  }
  if (n === 100) return "One hundred";
  return String(n);
}

function normalizeNumberText(text: string): string {
  return text.toLowerCase().replace(/[,.!?;:()[\]"']/g, " ").replace(/-/g, " ").replace(/\s+/g, " ").trim();
}

function cleanGoal(value: string): string | null {
  const cleaned = value.trim().replace(/^["']+|["'.!?]+$/g, "").slice(0, 400);
  return cleaned.length >= 4 ? cleaned : null;
}

function looksLikeTask(value: string): boolean {
  return /\b(count|plan|write|summarize|decide|find|make|build|draft|explain|compare|choose|list)\b/i.test(value);
}

function clampInt(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Math.trunc(value)));
}

function capitalize(value: string): string {
  return value.slice(0, 1).toUpperCase() + value.slice(1);
}
