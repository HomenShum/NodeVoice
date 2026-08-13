/**
 * Who is in the room, and whose turn is it.
 *
 * A room holds up to 100 seats. Each seat has a stable id ("agent-007"), a
 * name, a colour and a personality, and every device that joins takes one seat.
 * The three places that need to agree on this — the local Node server, the
 * hosted Convex backend, and the browser — import THIS file, so a room created
 * on a laptop and joined by a phone shows the same person in seat 2.
 *
 * Seat ids are zero-padded so they sort; "a".."e" are the ids the first version
 * shipped with and are still accepted so old links keep working.
 */

export type Slot = string;

export const MIN_AGENT_COUNT = 1;
export const DEFAULT_AGENT_COUNT = 2;
export const MAX_AGENT_COUNT = 100;

/**
 * How many turns one run may take. The live room has always paused an auto-run
 * here; the demo routes now clamp to the same number, so no request can ask for
 * three million turns and get three million allocated steps back.
 */
export const MAX_RUN_TURNS = 320;

const LEGACY_SLOT_INDEX: Record<string, number> = { a: 1, b: 2, c: 3, d: 4, e: 5 };

const AGENT_NAMES = [
  "Ada", "Ben", "Cara", "Dev", "Eli", "Fay", "Gus", "Hana", "Ira", "Jo",
  "Kai", "Lea", "Mika", "Noor", "Owen", "Pia", "Quin", "Rae", "Sol", "Tess",
];

const AGENT_COLORS = ["sky", "violet", "emerald", "amber", "rose", "cyan", "lime", "pink", "orange", "indigo"];

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

/** Everything about a seat EXCEPT its voice — each backend picks its own TTS. */
export interface AgentIdentity {
  slot: Slot;
  name: string;
  device: "laptop" | "phone";
  color: string;
  persona: string;
}

export function validAgentCount(value?: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return DEFAULT_AGENT_COUNT;
  return Math.max(MIN_AGENT_COUNT, Math.min(MAX_AGENT_COUNT, Math.trunc(value)));
}

/** Same shape as validAgentCount, for a requested turn count from JSON. */
export function validTurns(value: unknown, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.max(0, Math.min(MAX_RUN_TURNS, Math.trunc(value)));
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

export function isAgentSlot(value: unknown): value is Slot {
  return typeof value === "string" && agentIndexFromSlot(value) !== null;
}

export function activeSlots(agentCount?: number): Slot[] {
  return Array.from({ length: validAgentCount(agentCount) }, (_, i) => slotForIndex(i + 1));
}

export const AGENT_SLOTS = activeSlots(MAX_AGENT_COUNT);

/** Whose turn comes after this one, wrapping at the end of the room. */
export function nextSlot(slot: Slot, agentCount?: number): Slot {
  const slots = activeSlots(agentCount);
  const index = agentIndexFromSlot(slot);
  const current = index && index <= slots.length ? index - 1 : 0;
  return slots[(current + 1) % slots.length]!;
}

/** Seat 1 is the host's laptop; every later seat is a phone that joined. */
export function agentIdentity(slot: Slot): AgentIdentity {
  const index = agentIndexFromSlot(slot) ?? 1;
  const nameBase = AGENT_NAMES[(index - 1) % AGENT_NAMES.length]!;
  const cycle = Math.floor((index - 1) / AGENT_NAMES.length);
  return {
    slot: slotForIndex(index),
    name: cycle === 0 ? nameBase : `${nameBase} ${cycle + 1}`,
    device: index === 1 ? "laptop" : "phone",
    color: AGENT_COLORS[(index - 1) % AGENT_COLORS.length]!,
    persona: PERSONAS[(index - 1) % PERSONAS.length]!,
  };
}

export const DEFAULT_GOAL =
  "Plan a great Saturday for two friends in San Francisco and agree on a final 3-stop itinerary with rough timing.";

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
