// Records the README hero clip: the real quickstart path, nothing staged.
//
//   1. npm run ui            (build the client + start the server on :8787)
//   2. npm i --no-save playwright   (recorder dependency only; not in package.json)
//   3. node scripts/record-readme-hero.mjs
//   4. ffmpeg -i docs/media/readme-hero.webm \
//        -vf "fps=8,scale=960:-1:flags=lanczos,split[s0][s1];[s0]palettegen=max_colors=128[p];[s1][p]paletteuse=dither=bayer" \
//        docs/media/readme-hero.gif
//
// The clip opens http://localhost:8787 and clicks "Run the comparison" — the
// same 30-second quickstart the README promises. The comparison run itself is
// the deterministic no-key demo; what you see is what a fresh clone does.
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outDir = path.join(repoRoot, "docs", "media");
mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: { width: 1280, height: 800 },
  recordVideo: { dir: outDir, size: { width: 1280, height: 800 } },
});
const page = await context.newPage();

// The real path a fresh clone takes: land on the live-room lobby, follow
// "or watch the bad-vs-good demo" to /demo, then run the comparison.
await page.goto("http://localhost:8787", { waitUntil: "networkidle" });
await page.waitForTimeout(2_500); // let the lobby read before acting
await page.getByText("or watch the bad-vs-good demo").click();
const runButton = page.getByRole("button", { name: "Run the comparison" });
await runButton.waitFor({ state: "visible", timeout: 15_000 });
await page.waitForTimeout(2_000);

await runButton.click();
// The deterministic comparison returns fast, then the UI walks the good-room
// steps one by one. Record the walkthrough.
await page.waitForTimeout(20_000);

const video = page.video();
await context.close();
await browser.close();
const rawPath = await video.path();
console.log("recorded:", rawPath);
console.log("rename to docs/media/readme-hero.webm, then run the ffmpeg step above");
