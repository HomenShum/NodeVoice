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

  it("exposes swappable local model options for voice and nodeagents", () => {
    expect(LOCAL_MODEL_OPTIONS.length).toBeGreaterThan(10);
    expect(getModelsFor("voice").some((model) => model.ollamaModel === "llama3.2:3b")).toBe(true);
    expect(getModelsFor("nodeagent").some((model) => model.ollamaModel === "qwen3:4b")).toBe(true);
    expect(getOllamaModelName("qwen3_4b")).toBe("qwen3:4b");
  });
});
