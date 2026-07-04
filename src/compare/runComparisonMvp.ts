import { runSideBySideComparison } from "./badGoodDemo.js";

const target = Number(process.env.COUNT_TARGET ?? "12");
const turns = Number(process.env.TURNS ?? "9");
const useOllama = process.env.USE_OLLAMA === "1";
const model = process.env.OLLAMA_MODEL;

const result = await runSideBySideComparison({ target, turns, useOllama, model });

console.log("\nlocal-collab-mvp / side-by-side comparison");
console.log(`Model: ${useOllama ? result.selectedModel : "deterministic fallback"}`);
console.log("\nBAD: raw peer transcript reaction");
for (const step of result.bad) {
  console.log(`${String(step.turn).padStart(2)} ${step.actorId.padEnd(8)} ${step.text}`);
}
console.log("\nGOOD: server-authoritative room state");
for (const step of result.good) {
  console.log(`${String(step.turn).padStart(2)} ${step.actorId.padEnd(8)} ${step.text.padEnd(18)} ${step.roomStateSummary}`);
}
console.log("\nDiagnosis:");
for (const item of result.diagnosis) console.log(`- ${item}`);
