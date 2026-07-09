import { runLocalNodeAgentLoop } from "./nodeAgentLocalMvp.js";

const goal = process.argv.slice(2).join(" ") || "Build a local-first MVP where voice agents and NodeAgents continue work without acknowledgement loops.";
const useOllama = process.env.USE_OLLAMA === "1";
const model = process.env.OLLAMA_MODEL;

console.log("\nnodevoice / nodeagents");
console.log(`Goal: ${goal}`);
console.log(`Model: ${useOllama ? process.env.OLLAMA_MODEL ?? "llama3.2:3b" : "deterministic fallback"}\n`);

const result = await runLocalNodeAgentLoop(goal, useOllama, model);

for (const artifact of result.artifacts) {
  console.log(`- ${artifact.kind.padEnd(18)} ${artifact.title}`);
}

console.log("\nFinal phase:", result.state.task.kind === "nodeagent_loop" ? result.state.task.phase : "unknown");
console.log("Model cells:");
console.log(JSON.stringify(result.model.cells, null, 2));
console.log("\nMemo:");
const memo = result.artifacts.find((artifact) => artifact.kind === "notebook_memo")?.payload as { markdown?: string } | undefined;
console.log(memo?.markdown ?? "No memo produced");
