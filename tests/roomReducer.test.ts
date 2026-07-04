import { describe, expect, it } from "vitest";
import { applyUtterance, createVoiceRoom } from "../src/core/roomReducer.js";
import type { Utterance } from "../src/core/types.js";

function utt(actorId: Utterance["actorId"], text: string): Utterance {
  return { id: `${actorId}-${text}`, actorId, text, ts: Date.now() };
}

describe("room reducer", () => {
  it("commits counting task actions and advances the next speaker", () => {
    let state = createVoiceRoom(3);
    state = applyUtterance(state, utt("voice-a", "One"));
    expect(state.task.kind).toBe("count_to_n");
    if (state.task.kind === "count_to_n") {
      expect(state.task.current).toBe(1);
      expect(state.task.next).toBe(2);
    }
    expect(state.nextSpeaker).toBe("voice-b");
  });

  it("detects acknowledgement loops and requires concrete continuation", () => {
    let state = createVoiceRoom(10);
    state = applyUtterance(state, utt("voice-a", "Yeah exactly"));
    state = applyUtterance(state, utt("voice-b", "Yep let's do that"));
    expect(state.loopRisk).toBe(true);
    expect(state.requiredNextAct).toBe("task_action");
  });

  it("completes the counting task", () => {
    let state = createVoiceRoom(2);
    state = applyUtterance(state, utt("voice-a", "One"));
    state = applyUtterance(state, utt("voice-b", "Two"));
    expect(state.task.completed).toBe(true);
    expect(state.nextSpeaker).toBe(null);
  });
});
