/** Shared, side-effect-free definitions used by both mutations and actions. */

export type Slot = string;

export interface AgentDef {
  slot: Slot;
  name: string;
  device: "laptop" | "phone";
  openaiVoice: string;
  persona: string;
  color: string;
}

const LEGACY_SLOT_INDEX: Record<string, number> = { a: 1, b: 2, c: 3, d: 4, e: 5 };
const AGENT_NAMES = [
  "Ada",
  "Ben",
  "Cara",
  "Dev",
  "Eli",
  "Fay",
  "Gus",
  "Hana",
  "Ira",
  "Jo",
  "Kai",
  "Lea",
  "Mika",
  "Noor",
  "Owen",
  "Pia",
  "Quin",
  "Rae",
  "Sol",
  "Tess",
];
const OPENAI_VOICES = ["nova", "onyx", "shimmer", "echo", "fable"] as const;
const AGENT_COLORS = ["sky", "violet", "emerald", "amber", "rose", "cyan", "lime", "pink", "orange", "indigo"] as const;
const PERSONAS = [
  "A decisive planner. Proposes concrete, specific options with names and rough timing, and pushes to lock decisions.",
  "A thoughtful challenger. Asks one sharp question, checks constraints and budget, then refines the plan.",
  "A concise synthesizer. Tracks the shared state, resolves ambiguity, and turns partial ideas into crisp next steps.",
  "A practical operator. Checks feasibility, catches edge cases, and keeps the group moving without over-talking.",
  "A final reviewer. Looks for missing constraints, confirms decisions, and helps close tasks cleanly.",
  "A creative scout. Offers one fresh option when the room is stuck, then hands the floor back to execution.",
  "A systems thinker. Notices dependencies, sequencing, and failure modes before they become expensive.",
  "A user advocate. Keeps the conversation grounded in what a real person would understand and do next.",
];

export const MIN_AGENT_COUNT = 1;
export const DEFAULT_AGENT_COUNT = 2;
export const MAX_AGENT_COUNT = 100;

export function validAgentCount(value?: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return DEFAULT_AGENT_COUNT;
  return Math.max(MIN_AGENT_COUNT, Math.min(MAX_AGENT_COUNT, Math.trunc(value)));
}

export function slotForIndex(index: number): Slot {
  const n = Math.max(1, Math.min(MAX_AGENT_COUNT, Math.trunc(index)));
  return `agent-${String(n).padStart(3, "0")}`;
}

export function agentIndexFromSlot(slot: string): number | null {
  if (slot in LEGACY_SLOT_INDEX) return LEGACY_SLOT_INDEX[slot]!;
  const match = /^agent-(\d{3})$/.exec(slot);
  if (!match) return null;
  const n = Number(match[1]);
  return Number.isInteger(n) && n >= 1 && n <= MAX_AGENT_COUNT ? n : null;
}

export function activeSlots(agentCount?: number): Slot[] {
  return Array.from({ length: validAgentCount(agentCount) }, (_, i) => slotForIndex(i + 1));
}

export function isAgentSlot(value: unknown): value is Slot {
  return typeof value === "string" && agentIndexFromSlot(value) !== null;
}

export function nextSlot(slot: Slot, agentCount?: number): Slot {
  const slots = activeSlots(agentCount);
  const index = agentIndexFromSlot(slot);
  const current = index && index <= slots.length ? index - 1 : 0;
  return slots[(current + 1) % slots.length]!;
}

export function agentForSlot(slot: Slot): AgentDef {
  const index = agentIndexFromSlot(slot) ?? 1;
  const nameBase = AGENT_NAMES[(index - 1) % AGENT_NAMES.length]!;
  const cycle = Math.floor((index - 1) / AGENT_NAMES.length);
  return {
    slot: slotForIndex(index),
    name: cycle === 0 ? nameBase : `${nameBase} ${cycle + 1}`,
    device: index === 1 ? "laptop" : "phone",
    openaiVoice: OPENAI_VOICES[(index - 1) % OPENAI_VOICES.length]!,
    color: AGENT_COLORS[(index - 1) % AGENT_COLORS.length]!,
    persona: PERSONAS[(index - 1) % PERSONAS.length]!,
  };
}

export const AGENT_SLOTS = activeSlots(MAX_AGENT_COUNT);
export const AGENTS: Record<Slot, AgentDef> = new Proxy({} as Record<Slot, AgentDef>, {
  get(_target, prop) {
    return agentForSlot(String(prop));
  },
});

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

export const CAPABILITY_PROFILES = [
  {
    id: "v0_no_room_state",
    label: "V0 Failure",
    shortLabel: "V0",
    note: "raw transcript agents; no durable room-state steering",
  },
  {
    id: "v1_room_state",
    label: "V1 Room State",
    shortLabel: "V1",
    note: "shared goal, floor owner, reducer, traces, durable steering",
  },
  {
    id: "v2_work_room",
    label: "V2 Work Room",
    shortLabel: "V2",
    note: "room-state plus typed intent routing for work/artifacts",
  },
  {
    id: "v3_agent_ecosystem",
    label: "V3 Ecosystem",
    shortLabel: "V3",
    note: "adapter lane for external agent stacks and subagents",
  },
] as const;

export type CapabilityProfile = (typeof CAPABILITY_PROFILES)[number]["id"];
export const DEFAULT_PROFILE: CapabilityProfile = "v1_room_state";

export function validProfile(profile?: string): CapabilityProfile {
  return CAPABILITY_PROFILES.some((p) => p.id === profile) ? (profile as CapabilityProfile) : DEFAULT_PROFILE;
}

export function profileUsesRoomState(profile?: string): boolean {
  return validProfile(profile) !== "v0_no_room_state";
}

export const other = (slot: Slot): Slot => nextSlot(slot, 2);

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

interface CountCommand {
  start: number;
  target: number;
}

export type HumanSteeringIntent =
  | { kind: "none"; confidence?: number; reason?: string }
  | { kind: "question"; question?: string; confidence?: number; reason?: string }
  | { kind: "constraint"; note: string; confidence?: number; reason?: string }
  | { kind: "retarget"; goal: string; confidence?: number; reason?: string }
  | { kind: "count_task"; start: number; target: number; confidence?: number; reason?: string }
  | { kind: "control"; action: "start" | "pause" | "resume" | "stop"; confidence?: number; reason?: string };

export function deriveGoalOverrideFromHuman(text: string): string | null {
  const trimmed = text.trim();
  if (!trimmed) return null;

  const explicit = trimmed.match(
    /^(?:new\s+goal|change\s+(?:the\s+)?goal|set\s+(?:the\s+)?goal|switch\s+(?:the\s+)?(?:goal|task)|replace\s+(?:the\s+)?(?:goal|task))(?:\s+(?:to|as))?\s*[:,-]?\s*(.+)$/i,
  );
  if (explicit?.[1]) {
    const goal = cleanGoal(explicit[1]);
    if (!goal) return null;
    const countCommand = extractCountCommand(goal);
    return countCommand ? buildCountGoal(countCommand.start, countCommand.target) : goal;
  }

  if (isInterrogative(trimmed)) return null;

  const countCommand = extractCountCommand(trimmed);
  if (countCommand !== null) return buildCountGoal(countCommand.start, countCommand.target);

  const correction = trimmed.match(/^(?:actually|instead)\s*[,:-]?\s*(?:let'?s\s+)?(.+)$/i);
  if (correction?.[1] && looksLikeTask(correction[1])) {
    const goal = cleanGoal(correction[1]);
    if (!goal) return null;
    const correctedCount = extractCountCommand(goal);
    return correctedCount ? buildCountGoal(correctedCount.start, correctedCount.target) : goal;
  }

  return null;
}

export function deriveCountTask(goal: string, next?: number): CountTask | null {
  const command = extractCountCommand(goal);
  if (command === null) return null;
  return {
    kind: "count_to_n",
    target: command.target,
    next: clampInt(next ?? command.start, command.start, command.target),
  };
}

export function buildCountGoal(startOrTarget: number, maybeTarget?: number): string {
  const start = maybeTarget === undefined ? 1 : startOrTarget;
  const target = maybeTarget === undefined ? startOrTarget : maybeTarget;
  return `Count from ${start} to ${target} out loud, one number per agent turn, stopping exactly at ${target}.`;
}

export function goalFromHumanSteeringIntent(intent: HumanSteeringIntent): string | null {
  if (intent.kind === "count_task") return buildCountGoal(intent.start, intent.target);
  if (intent.kind !== "retarget") return null;
  const goal = cleanGoal(intent.goal);
  if (!goal) return null;
  const countCommand = extractCountCommand(goal);
  return countCommand ? buildCountGoal(countCommand.start, countCommand.target) : goal;
}

export function deriveHumanSteeringIntentFallback(text: string): HumanSteeringIntent {
  const trimmed = text.trim().slice(0, 400);
  if (!trimmed) return { kind: "none", confidence: 0, reason: "empty steer" };

  const goal = deriveGoalOverrideFromHuman(trimmed);
  if (goal) {
    const countTask = deriveCountTask(goal);
    return countTask
      ? { kind: "count_task", start: countTask.next, target: countTask.target, confidence: 0.6, reason: "deterministic fallback count parse" }
      : { kind: "retarget", goal, confidence: 0.55, reason: "deterministic fallback goal parse" };
  }

  const control = fallbackControl(trimmed);
  if (control) return control;
  if (isInterrogative(trimmed)) return { kind: "question", question: trimmed, confidence: 0.65, reason: "deterministic fallback question" };
  if (looksLikeConstraint(trimmed)) return { kind: "constraint", note: trimmed, confidence: 0.55, reason: "deterministic fallback constraint" };
  return { kind: "none", confidence: 0.5, reason: "no state-changing intent detected" };
}

export function normalizeHumanSteeringIntent(raw: unknown, fallbackText: string): HumanSteeringIntent {
  if (!isRecord(raw)) return deriveHumanSteeringIntentFallback(fallbackText);
  const kind = String(raw.kind ?? raw.intent ?? "none").toLowerCase().replace(/[-\s]/g, "_");
  const confidence = confidenceValue(raw.confidence);
  const reason = optionalText(raw.reason, 180);
  const withMeta = <T extends HumanSteeringIntent>(intent: T): T => ({ ...intent, confidence, ...(reason ? { reason } : {}) });

  if (kind === "count_task" || kind === "count" || kind === "count_to_n") {
    const nested = isRecord(raw.count) ? raw.count : {};
    const target = positiveInt(raw.target ?? raw.countTarget ?? nested.target);
    const start = positiveInt(raw.start ?? raw.countStart ?? nested.start) ?? 1;
    if (target !== null && validCountRange(start, target)) return withMeta({ kind: "count_task", start, target });
    return deriveHumanSteeringIntentFallback(fallbackText);
  }

  if (kind === "retarget" || kind === "new_goal" || kind === "goal" || kind === "task") {
    const goal = cleanGoal(String(raw.goal ?? raw.task ?? raw.value ?? ""));
    return goal ? withMeta({ kind: "retarget", goal }) : deriveHumanSteeringIntentFallback(fallbackText);
  }

  if (kind === "constraint" || kind === "nudge") {
    const note = cleanGoal(String(raw.note ?? raw.constraint ?? raw.value ?? fallbackText));
    return note ? withMeta({ kind: "constraint", note }) : { kind: "none", confidence, reason };
  }

  if (kind === "question" || kind === "clarification") {
    return withMeta({ kind: "question", question: optionalText(raw.question, 300) ?? fallbackText.trim().slice(0, 300) });
  }

  if (kind === "control") {
    const action = String(raw.action ?? "").toLowerCase();
    if (action === "start" || action === "pause" || action === "resume" || action === "stop") return withMeta({ kind: "control", action });
  }

  if (kind === "none" || kind === "ack" || kind === "approval") return withMeta({ kind: "none" });
  return deriveHumanSteeringIntentFallback(fallbackText);
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

function extractCountCommand(text: string): CountCommand | null {
  let best: CountCommand | null = null;
  for (const clause of splitCountClauses(text)) {
    const command = parseCountClause(clause);
    if (command) best = command;
  }
  return best;
}

function parseNumberPhrase(text: string): number | null {
  const normalized = normalizeNumberText(text);
  const tokens = normalized.split(/\s+/).filter(Boolean);
  for (let i = 0; i < tokens.length; i += 1) {
    const parsed = parseLeadingNumberPhrase(tokens, i);
    if (parsed) return parsed.value;
  }
  return null;
}

function parseCountClause(text: string): CountCommand | null {
  const tokens = normalizeNumberText(text).split(/\s+/).filter(Boolean);
  let best: CountCommand | null = null;
  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i];
    if (token !== "count" && token !== "counting") continue;
    if (!hasOnlySoftPrefix(tokens.slice(0, i))) continue;
    if (isNegatedCount(tokens, i)) continue;
    const command = parseCountAfter(tokens, i);
    if (command) best = command;
  }
  return best;
}

function parseCountAfter(tokens: string[], countIndex: number): CountCommand | null {
  const fromIndex = findToken(tokens, "from", countIndex + 1, Math.min(tokens.length, countIndex + 8));
  if (fromIndex !== -1) {
    const start = parseLeadingNumberPhrase(tokens, fromIndex + 1);
    if (start) {
      const connectorEnd = findTargetConnector(tokens, start.nextIndex);
      if (connectorEnd !== -1) return validCountRange(start.value, parseLeadingNumberPhrase(tokens, connectorEnd)?.value ?? null);
    }
  }

  const connectorEnd = findTargetConnector(tokens, countIndex + 1);
  return connectorEnd === -1 ? null : validCountRange(1, parseLeadingNumberPhrase(tokens, connectorEnd)?.value ?? null);
}

function validCountRange(start: number, target: number | null): CountCommand | null {
  if (target === null || start < 1 || target < start || target > MAX_COUNT_TARGET) return null;
  return { start, target };
}

function parseLeadingNumberPhrase(tokens: string[], startIndex: number): { value: number; nextIndex: number } | null {
  const first = tokens[startIndex];
  if (!first) return null;
  if (/^\d{1,3}$/.test(first)) {
    const value = Number(first);
    return value > 0 ? { value, nextIndex: startIndex + 1 } : null;
  }

  let total = 0;
  let current = 0;
  let sawNumber = false;
  let i = startIndex;

  for (; i < tokens.length; i += 1) {
    const token = tokens[i]!;
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
      const next = tokens[i + 1];
      if (!sawNumber || !isNumberToken(next)) break;
      continue;
    } else if (sawNumber) {
      break;
    }
  }

  const value = total + current;
  return sawNumber && value > 0 ? { value, nextIndex: i } : null;
}

function splitCountClauses(text: string): string[] {
  return text
    .replace(/\b(?:but|then|instead)\b/gi, ",")
    .split(/[,.!?;:]/)
    .map((clause) => clause.trim())
    .filter(Boolean);
}

function findToken(tokens: string[], token: string, start: number, end: number): number {
  for (let i = start; i < end; i += 1) {
    if (tokens[i] === token) return i;
  }
  return -1;
}

function findTargetConnector(tokens: string[], start: number): number {
  for (let i = start; i < Math.min(tokens.length, start + 10); i += 1) {
    const token = tokens[i];
    if (token === "up" && tokens[i + 1] === "to") return i + 2;
    if (token === "to" || token === "through" || token === "until" || token === "till") return i + 1;
  }
  return -1;
}

function hasOnlySoftPrefix(tokens: string[]): boolean {
  const soft = new Set([
    "please",
    "hey",
    "i",
    "want",
    "need",
    "like",
    "lets",
    "let",
    "s",
    "us",
    "we",
    "should",
    "can",
    "could",
    "would",
    "you",
    "guys",
    "both",
    "each",
    "to",
    "one",
    "at",
    "time",
    "just",
    "now",
    "keep",
    "continue",
    "start",
    "starting",
    "go",
    "ahead",
    "actually",
  ]);
  return tokens.every((token) => soft.has(token));
}

function isNegatedCount(tokens: string[], countIndex: number): boolean {
  const window = tokens.slice(Math.max(0, countIndex - 4), countIndex);
  return window.some((token) => token === "not" || token === "never" || token === "stop" || token === "quit");
}

function isNumberToken(token: string | undefined): boolean {
  return Boolean(token && (/^\d{1,3}$/.test(token) || SMALL_NUMBERS[token] !== undefined || TENS_NUMBERS[token] !== undefined || token === "hundred"));
}

function isInterrogative(text: string): boolean {
  return /\?\s*$/.test(text) || /^(?:are|is|am|was|were|what|why|how|do|did|does|can|could|should|would|will|may|might|where|when|who|which)\b/i.test(text);
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
  return text
    .toLowerCase()
    .replace(/\bdon'?t\b/g, "do not")
    .replace(/[,.!?;:()[\]"']/g, " ")
    .replace(/-/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function cleanGoal(value: string): string | null {
  const cleaned = value.trim().replace(/^["']+|["'.!?]+$/g, "").slice(0, 400);
  return cleaned.length >= 4 ? cleaned : null;
}

function looksLikeTask(value: string): boolean {
  const tokens = normalizeNumberText(value).split(/\s+/).filter(Boolean);
  const firstTask = tokens.find((token) => !["please", "lets", "let", "s", "us", "we", "should", "can", "could", "would", "you", "just", "now"].includes(token));
  if (!firstTask) return false;
  if (!/^(count|plan|write|summarize|decide|find|make|build|draft|explain|compare|choose|list)$/.test(firstTask)) return false;
  const next = tokens[tokens.indexOf(firstTask) + 1];
  return !(firstTask === "plan" && (next === "sounds" || next === "is" || next === "was" || next === "seems"));
}

function looksLikeConstraint(value: string): boolean {
  return /\b(under|below|less than|no more than|budget|avoid|include|must|make sure|constraint|keep it|keep them|don't|do not)\b/i.test(value);
}

function fallbackControl(value: string): HumanSteeringIntent | null {
  const normalized = normalizeNumberText(value);
  if (/^(pause|stop|hold|wait)(\s|$)/.test(normalized)) return { kind: "control", action: "pause", confidence: 0.7, reason: "deterministic fallback control" };
  if (/^(start|resume|continue)(\s|$)/.test(normalized) && !/\bcount\b/.test(normalized)) {
    return { kind: "control", action: "resume", confidence: 0.65, reason: "deterministic fallback control" };
  }
  return null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function confidenceValue(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  return Math.max(0, Math.min(1, value));
}

function optionalText(value: unknown, max: number): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim().slice(0, max) : undefined;
}

function positiveInt(value: unknown): number | null {
  const n = typeof value === "number" ? value : typeof value === "string" && /^\d{1,3}$/.test(value.trim()) ? Number(value.trim()) : NaN;
  return Number.isFinite(n) && n > 0 ? Math.trunc(n) : null;
}

function clampInt(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Math.trunc(value)));
}

function capitalize(value: string): string {
  return value.slice(0, 1).toUpperCase() + value.slice(1);
}
