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

export function deriveCountTask(goal: string, next?: number): LiveCountTask | null {
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

function extractCountCommand(text: string): CountCommand | null {
  let best: CountCommand | null = null;
  for (const clause of splitCountClauses(text)) {
    const command = parseCountClause(clause);
    if (command) best = command;
  }
  return best;
}

function parseNumberPhrase(text: string): number | null {
  const normalized = normalize(text);
  const tokens = normalized.split(/\s+/).filter(Boolean);
  for (let i = 0; i < tokens.length; i += 1) {
    const parsed = parseLeadingNumberPhrase(tokens, i);
    if (parsed) return parsed.value;
  }
  return null;
}

function parseCountClause(text: string): CountCommand | null {
  const tokens = normalize(text).split(/\s+/).filter(Boolean);
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

function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/\bdon'?t\b/g, "do not")
    .replace(/[,.!?;:()[\]"']/g, " ")
    .replace(/-/g, " ")
    .replace(/\s+/g, " ")
    .trim();
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
  return Boolean(token && (/^\d{1,3}$/.test(token) || SMALL[token] !== undefined || TENS[token] !== undefined || token === "hundred"));
}

function isInterrogative(text: string): boolean {
  return /\?\s*$/.test(text) || /^(?:are|is|am|was|were|what|why|how|do|did|does|can|could|should|would|will|may|might|where|when|who|which)\b/i.test(text);
}

function cleanGoal(value: string): string | null {
  const cleaned = value.trim().replace(/^["']+|["'.!?]+$/g, "").slice(0, 400);
  return cleaned.length >= 4 ? cleaned : null;
}

function looksLikeTask(value: string): boolean {
  const tokens = normalize(value).split(/\s+/).filter(Boolean);
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
  const normalized = normalize(value);
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
