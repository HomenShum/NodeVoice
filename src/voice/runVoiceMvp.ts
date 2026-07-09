import { createVoiceRoom } from "../core/roomReducer.js";
import { VOICE_AGENT_IDS } from "../core/types.js";
import { runVoiceStep } from "./voiceAgent.js";

const target = Number(process.env.COUNT_TARGET ?? "30");
const useOllama = process.env.USE_OLLAMA === "1";
const model = process.env.OLLAMA_MODEL;
let state = createVoiceRoom(target);

console.log("\nnodevoice / voice agents");
console.log("Task: three local agents count without acknowledgement loops.");
console.log(`Model: ${useOllama ? process.env.OLLAMA_MODEL ?? "llama3.2:3b" : "deterministic fallback"}\n`);

while (state.task.kind === "count_to_n" && !state.task.completed) {
  const actorId = state.nextSpeaker ?? VOICE_AGENT_IDS[0]!;
  state = await runVoiceStep(state, { actorId, label: actorId, useOllama, model });
  const last = state.utterances.at(-1)!;
  const nextValue = state.task.kind === "count_to_n" ? state.task.next : "n/a";
  console.log(`${last.actorId.padEnd(8)} ${last.text.padEnd(18)} act=${last.speechAct} next=${nextValue} loopRisk=${state.loopRisk}`);
}

console.log("\nDone. Final state:");
console.log(JSON.stringify({ current: state.task.kind === "count_to_n" ? state.task.current : null, loopRisk: state.loopRisk, utterances: state.utterances.length }, null, 2));
