/**
 * What the hosted Convex backend shares with the rest of the app.
 *
 * The room rules — who sits in which seat, whose turn is next, what a person
 * meant when they said "count to one hundred" — are NOT written here. They live
 * once in `src/core/` and are imported, so the hosted room and the room you run
 * on your laptop cannot disagree. This file only adds what is specific to
 * Convex: the OpenAI voice each seat speaks with, and the V3 policy record that
 * is stored in the Convex `rooms` table.
 *
 * Convex bundles its functions with esbuild and follows imports outside the
 * `convex/` directory, so `../src/core/*` ships with the deployment. Verified by
 * `npm run check:convex` and reproduced in docs/SIMPLIFICATION_REPORT.md.
 */

import { agentIdentity, type AgentIdentity, type Slot } from "../src/core/agents.js";

export {
  MIN_AGENT_COUNT,
  DEFAULT_AGENT_COUNT,
  MAX_AGENT_COUNT,
  AGENT_SLOTS,
  DEFAULT_GOAL,
  validAgentCount,
  slotForIndex,
  agentIndexFromSlot,
  activeSlots,
  isAgentSlot,
  nextSlot,
  makeRoomCode,
  estimateSpeechMs,
} from "../src/core/agents.js";
export type { Slot } from "../src/core/agents.js";

export { ROUTER_MODELS, DEFAULT_MODEL, validModel } from "../src/core/routerModels.js";

export {
  CAPABILITY_PROFILES,
  DEFAULT_PROFILE,
  validProfile,
  profileUsesRoomState,
  profileUsesAgentOs,
  deriveGoalOverrideFromHuman,
  deriveCountTask,
  buildCountGoal,
  goalFromHumanSteeringIntent,
  shouldReplaceAgentOsGoal,
  agentOsGoalKind,
  deriveHumanSteeringIntentFallback,
  normalizeHumanSteeringIntent,
  coerceCountTurn,
} from "../src/core/steering.js";
export type { CapabilityProfile, CountTask, CountTurnLike, HumanSteeringIntent } from "../src/core/steering.js";

export { numberToWords } from "../src/core/numberWords.js";

/** A seat plus the OpenAI voice it speaks with. Convex-only: the Node server
 *  pairs the same seats with ElevenLabs voice ids instead. */
export interface AgentDef extends AgentIdentity {
  openaiVoice: string;
}

const OPENAI_VOICES = ["nova", "onyx", "shimmer", "echo", "fable"] as const;

export function agentForSlot(slot: Slot): AgentDef {
  const identity = agentIdentity(slot);
  const index = Number(identity.slot.slice(-3));
  return { ...identity, openaiVoice: OPENAI_VOICES[(index - 1) % OPENAI_VOICES.length]! };
}

/**
 * What a V3 room is allowed to spend and reach. A person running an "agent OS"
 * room caps how many background workers it may spawn and whether those workers
 * may browse the web; the room refuses to exceed it.
 */
export interface AgentOsPolicy {
  budgetMaxWorkers: number;
  budgetWorkersUsed: number;
  permissionWebResearch: boolean;
  permissionExternalActions: boolean;
}

export const DEFAULT_AGENT_OS_POLICY: AgentOsPolicy = {
  budgetMaxWorkers: 16,
  budgetWorkersUsed: 0,
  permissionWebResearch: true,
  permissionExternalActions: false,
};

export function normalizeAgentOsPolicy(value: Partial<AgentOsPolicy> = {}): AgentOsPolicy {
  const max = typeof value.budgetMaxWorkers === "number" && Number.isFinite(value.budgetMaxWorkers) ? Math.trunc(value.budgetMaxWorkers) : DEFAULT_AGENT_OS_POLICY.budgetMaxWorkers;
  const used = typeof value.budgetWorkersUsed === "number" && Number.isFinite(value.budgetWorkersUsed) ? Math.trunc(value.budgetWorkersUsed) : DEFAULT_AGENT_OS_POLICY.budgetWorkersUsed;
  return {
    budgetMaxWorkers: Math.max(1, Math.min(200, max)),
    budgetWorkersUsed: Math.max(0, used),
    permissionWebResearch: value.permissionWebResearch ?? DEFAULT_AGENT_OS_POLICY.permissionWebResearch,
    permissionExternalActions: value.permissionExternalActions ?? DEFAULT_AGENT_OS_POLICY.permissionExternalActions,
  };
}
