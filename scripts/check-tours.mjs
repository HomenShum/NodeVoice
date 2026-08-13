#!/usr/bin/env node
/**
 * A CodeTour with a stale line number is worse than no tour, because a reader
 * follows it and lands on unrelated code. Every step in `.tours/*.tour` carries
 * an `anchor` — the text that step is pointing at. This checks that the anchor
 * is still on the recorded line, and prints the corrected line number when it
 * is not.
 *
 *   node scripts/check-tours.mjs      (also runs as part of `npm run doctor`)
 */
import { readFileSync, readdirSync } from "node:fs";

let broken = 0;
let checked = 0;

for (const name of readdirSync(".tours").filter((f) => f.endsWith(".tour"))) {
  const tour = JSON.parse(readFileSync(`.tours/${name}`, "utf8"));
  for (const [i, step] of tour.steps.entries()) {
    checked += 1;
    const where = `${name} step ${i + 1} → ${step.file}:${step.line}`;
    let lines;
    try {
      lines = readFileSync(step.file, "utf8").split(/\r?\n/);
    } catch {
      console.error(`MISSING FILE  ${where}`);
      broken += 1;
      continue;
    }
    if (!step.anchor) {
      console.error(`NO ANCHOR     ${where} (cannot be verified)`);
      broken += 1;
      continue;
    }
    if (lines[step.line - 1]?.includes(step.anchor)) continue;
    const found = lines.findIndex((l) => l.includes(step.anchor));
    console.error(`STALE LINE    ${where} — anchor ${JSON.stringify(step.anchor)} is ${found === -1 ? "gone" : `now on line ${found + 1}`}`);
    broken += 1;
  }
}

console.log(`${checked} tour steps checked, ${broken} broken`);
process.exit(broken ? 1 : 0);
