import { describe, expect, it } from "vitest";
import { runLocalNodeAgentLoop } from "../src/nodeagents/nodeAgentLocalMvp.js";

describe("local nodeagent mvp", () => {
  it("runs a four-artifact NodeAgent loop without provider keys", async () => {
    const result = await runLocalNodeAgentLoop("Build local collaboration MVP", false);
    expect(result.artifacts.map((artifact) => artifact.kind)).toEqual([
      "context_bundle",
      "grounded_answer",
      "spreadsheet_delta",
      "notebook_memo",
    ]);
    expect(result.state.task.kind).toBe("nodeagent_loop");
    if (result.state.task.kind === "nodeagent_loop") {
      expect(result.state.task.completed).toBe(true);
      expect(result.state.task.phase).toBe("done");
    }
    expect(result.model.version).toBe(2);
  });
});
