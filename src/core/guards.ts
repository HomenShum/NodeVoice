import type { AgentDecision, RoomState } from "./types.js";

const ACK_PREFIXES = [/^yeah\b/i, /^yah\b/i, /^yep\b/i, /^exactly\b/i, /^great\b/i, /^ok\b/i, /^okay\b/i, /^sounds good\b/i];

export function enforceRoomPolicy(state: RoomState, decision: AgentDecision): AgentDecision {
  if (state.suppressAcknowledgements && ACK_PREFIXES.some((pattern) => pattern.test(decision.text.trim()))) {
    return {
      ...decision,
      blocked: true,
      blockReason: "acknowledgement suppressed because the room requires concrete continuation",
    };
  }

  if (state.requiredNextAct && decision.intendedSpeechAct !== state.requiredNextAct) {
    return {
      ...decision,
      blocked: true,
      blockReason: `room requires ${state.requiredNextAct}; agent attempted ${decision.intendedSpeechAct}`,
    };
  }

  return decision;
}
