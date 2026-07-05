import { describe, expect, it } from "vitest";
import { runSideBySideComparison } from "../src/compare/badGoodDemo.js";
import { LOCAL_MODEL_OPTIONS, getModelsFor, getOllamaModelName } from "../src/providers/localModels.js";

describe("side-by-side comparison mvp", () => {
  it("shows bad loop stuck while good loop advances the counter", async () => {
    const result = await runSideBySideComparison({ target: 6, turns: 6, useOllama: false });
    expect(result.bad.some((step) => /exactly|agree|continue/i.test(step.text))).toBe(true);
    expect(result.good.map((step) => step.current)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(result.goodFinalState.task.completed).toBe(true);
  });

  it("exposes three divergent private states that drive the bad-side utterances", async () => {
    const result = await runSideBySideComparison({ target: 6, turns: 9, useOllama: false });

    // every bad turn snapshots all three private states for the inspector UI
    for (const step of result.bad) {
      expect(step.agentStates).toHaveLength(3);
    }

    // the utterance is state-driven: voice-a's start-counting intent produces
    // the instruction; every later politeness-reflex turn is a backchannel
    expect(result.bad[0]?.speechAct).toBe("instruction");
    expect(result.bad.slice(1).every((step) => step.speechAct === "backchannel")).toBe(true);

    // punchline: every agent's private belief stalls at 1 — nobody commits 2
    const last = result.bad.at(-1)?.agentStates ?? [];
    expect(last.map((state) => state.believesCurrent)).toEqual([1, 1, 1]);

    // intents only ever oscillate between acknowledge and wait-for-someone
    for (const step of result.bad) {
      for (const state of step.agentStates ?? []) {
        expect(["acknowledge", "wait-for-someone"]).toContain(state.nextIntent);
      }
    }
    for (const agentId of ["voice-a", "voice-b", "voice-c"]) {
      const timeline = result.bad.map(
        (step) => step.agentStates?.find((state) => state.agentId === agentId)?.nextIntent,
      );
      expect(new Set(timeline).size).toBeGreaterThan(1); // oscillates, not static
    }
  });

  it("reports honest provenance in no-key deterministic mode", async () => {
    const result = await runSideBySideComparison({ target: 4, turns: 4, useOllama: false });
    expect(result.provenance.mode).toBe("deterministic");
    expect(result.provenance.modelId).toBeNull();
    expect(result.provenance.bad).toContain("scripted");
    expect(result.provenance.good).toContain("deterministic sim");
    expect(result.provenance.good).toContain("real reducer & scheduler");
  });

  it("exposes swappable local model options for voice and nodeagents", () => {
    expect(LOCAL_MODEL_OPTIONS.length).toBeGreaterThan(10);
    expect(getModelsFor("voice").some((model) => model.ollamaModel === "llama3.2:3b")).toBe(true);
    expect(getModelsFor("nodeagent").some((model) => model.ollamaModel === "qwen3:4b")).toBe(true);
    expect(getOllamaModelName("qwen3_4b")).toBe("qwen3:4b");
  });
});
