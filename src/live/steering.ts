import { numberToWords } from "../core/numberWords.js";

export interface LiveCountTask {
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

const SMALL: Record<string, number> = {
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

const TENS: Record<string, number> = {
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

export function deriveCountTask(goal: string, next = 1): LiveCountTask | null {
  const target = extractCountTarget(goal);
  if (target === null) return null;
  return { kind: "count_to_n", target, next: clampInt(next, 1, target) };
}

export function buildCountGoal(target: number): string {
  return `Count from 1 to ${target} out loud, one number per agent turn, stopping exactly at ${target}.`;
}

export function coerceCountTurn<T extends CountTurnLike>(turn: T, task: LiveCountTask): T {
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
  const normalized = normalize(text);
  const match = normalized.match(/\bcount(?:ing)?(?:\s+up)?(?:\s+out\s+loud)?(?:\s+from\s+[\w\s-]+?)?\s+(?:to|through|until)\s+([\w\s-]+)/i);
  if (!match?.[1]) return null;
  const target = parseNumberPhrase(match[1]);
  return target !== null && target > 0 && target <= MAX_COUNT_TARGET ? target : null;
}

function parseNumberPhrase(text: string): number | null {
  const normalized = normalize(text);
  const digit = normalized.match(/\b(\d{1,3})\b/);
  if (digit?.[1]) return Number(digit[1]);

  const tokens = normalized.split(/\s+/).filter(Boolean);
  let total = 0;
  let current = 0;
  let sawNumber = false;

  for (const token of tokens) {
    if (SMALL[token] !== undefined) {
      current += SMALL[token];
      sawNumber = true;
    } else if (TENS[token] !== undefined) {
      current += TENS[token];
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

function normalize(text: string): string {
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
