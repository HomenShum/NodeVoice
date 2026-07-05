import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { runSideBySideComparison, type ComparisonSource } from "./badGoodDemo.js";

// Load OPENAI_API_KEY etc. from the gitignored .env.local (same as src/server.ts).
const envPath = resolve(fileURLToPath(new URL("../../.env.local", import.meta.url)));
const loadEnvFile = (process as unknown as { loadEnvFile?: (p: string) => void }).loadEnvFile;
try {
  loadEnvFile?.(envPath);
} catch {
  /* .env.local is optional (deterministic mode needs no keys) */
}

const target = Number(process.env.COUNT_TARGET ?? "12");
const turns = Number(process.env.TURNS ?? "9");
const useOllama = process.env.USE_OLLAMA === "1";
const model = process.env.OLLAMA_MODEL;
// SOURCE=deterministic|ollama|openai (openai needs OPENAI_API_KEY in the env / .env.local)
const source: ComparisonSource | undefined =
  process.env.SOURCE === "openai" || process.env.SOURCE === "ollama" || process.env.SOURCE === "deterministic"
    ? process.env.SOURCE
    : undefined;

const result = await runSideBySideComparison({ target, turns, useOllama, model, source });

console.log("\nlocal-collab-mvp / side-by-side comparison");
console.log(`Model: ${result.provenance.mode === "deterministic" ? "deterministic fallback" : result.selectedModel}`);
console.log(`Provenance (bad):  ${result.provenance.bad}`);
console.log(`Provenance (good): ${result.provenance.good}`);
console.log("\nBAD: raw peer transcript reaction");
for (const step of result.bad) {
  console.log(`${String(step.turn).padStart(2)} ${step.actorId.padEnd(8)} ${step.text}`);
  for (const agent of step.agentStates ?? []) {
    console.log(
      `     ${agent.agentId.padEnd(8)} believes=${agent.believesCurrent} heard=${agent.heardCount} spoke=${agent.spokeCount} classified=${agent.lastClassifiedAs.padEnd(11)} intent=${agent.nextIntent}`,
    );
  }
}
const lastBad = result.bad.at(-1);
if (lastBad?.agentStates) {
  const beliefs = lastBad.agentStates.map((agent) => `${agent.agentId}=${agent.believesCurrent}`).join(" ");
  console.log(`\nDivergence: 3 private beliefs (${beliefs}) with no shared truth — every agent waits for another to commit 2; none ever does.`);
}
console.log("\nGOOD: server-authoritative room state");
for (const step of result.good) {
  console.log(`${String(step.turn).padStart(2)} ${step.actorId.padEnd(8)} ${step.text.padEnd(18)} ${step.roomStateSummary}`);
}
console.log("\nDiagnosis:");
for (const item of result.diagnosis) console.log(`- ${item}`);
