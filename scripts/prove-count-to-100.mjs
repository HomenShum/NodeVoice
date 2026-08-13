// Re-proves defect D1 in the RENDERED app: the shared-room demo that carries
// the product's headline claim ("count to 100 together") actually reaches 100.
//
// Before the fix to src/core/numberWords.ts, SHARED-ROOM PROGRESS pinned at
// 99/100 forever — extractNumber("One hundred") read only the first token and
// returned 1, so the reducer asked for 100, heard 1, and demanded a correction.
//
//   1. npm run build
//   2. PORT=4307 npx tsx src/server.ts        (any free port; pass it below)
//   3. npm i --no-save playwright             (capture-only dep, as in record-readme-hero.mjs)
//   4. node scripts/prove-count-to-100.mjs    (BASE_URL=http://127.0.0.1:4307 by default)
//
// Writes promotion/evidence/iteration-1/: 01-demo-100of100.png and
// count-to-100.json. Exits non-zero if the demo does not reach 100.
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outDir = path.join(repoRoot, "promotion", "evidence", "iteration-1");
const baseUrl = process.env.BASE_URL ?? "http://127.0.0.1:4307";
mkdirSync(outDir, { recursive: true });

// The same request the /demo button issues, at the shipped defaults.
const apiResponse = await fetch(`${baseUrl}/compare/demo`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ target: 100, turns: 100, source: "deterministic" }),
});
const api = await apiResponse.json();
const lastGoodStep = api.good?.at(-1) ?? null;

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
const page = await context.newPage();
const consoleErrors = [];
const failedRequests = [];
page.on("console", (msg) => {
  if (msg.type() === "error" || msg.type() === "warning") consoleErrors.push(msg.text());
});
page.on("pageerror", (error) => consoleErrors.push(String(error)));
page.on("requestfailed", (request) => failedRequests.push(request.url()));
page.on("response", (response) => {
  if (response.status() >= 400) failedRequests.push(`${response.status()} ${response.url()}`);
});

await page.goto(`${baseUrl}/demo`, { waitUntil: "networkidle" });
await page.getByRole("button", { name: /run the comparison/i }).click();

// The walkthrough is paced at ~1.25 s/turn, so 100 turns takes ~125 s of
// deliberate playback. Poll the rendered readout rather than the API.
const progressRe = /\b(\d{1,3})\s*\/\s*100\b/;
const started = Date.now();
let progress = null;
let firstHundredMs = null;
const samples = [];
while (Date.now() - started < 300_000) {
  const body = await page.evaluate(() => document.body.innerText);
  const match = body.match(progressRe);
  const current = match ? Number(match[1]) : null;
  if (current !== progress) {
    progress = current;
    samples.push({ current, atMs: Date.now() - started });
  }
  if (current === 100) {
    firstHundredMs = Date.now() - started;
    break;
  }
  await page.waitForTimeout(1000);
}

// One 1280x800 viewport shot holds the whole claim: the SHARED-ROOM PROGRESS
// readout, the reducer's roomState, and the stuck-at-1 room beside it.
await page.screenshot({ path: path.join(outDir, "01-demo-100of100.png"), fullPage: false });

const findings = {
  capturedAt: new Date().toISOString(),
  baseUrl,
  defect: "D1 — shared-room demo stalled at 99/100 and could never reach 100",
  api: {
    status: apiResponse.status,
    lastGoodStep,
    goodFinalCurrent: api.goodFinalState?.task?.current ?? null,
    goodFinalCompleted: api.goodFinalState?.task?.completed ?? null,
  },
  rendered: {
    finalProgress: progress,
    reached100: progress === 100,
    firstHundredMs,
    progressSamples: samples,
  },
  consoleErrors,
  failedRequests,
};
writeFileSync(path.join(outDir, "count-to-100.json"), `${JSON.stringify(findings, null, 2)}\n`);

await context.close();
await browser.close();

console.log(JSON.stringify(findings.api, null, 2));
console.log(`rendered final progress: ${progress}/100 after ${firstHundredMs ?? "n/a"} ms`);
if (progress !== 100 || findings.api.goodFinalCompleted !== true) {
  console.error("D1 NOT fixed: the demo did not reach 100 in the rendered app.");
  process.exit(1);
}
