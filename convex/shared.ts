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
