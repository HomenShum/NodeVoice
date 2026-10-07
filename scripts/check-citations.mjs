#!/usr/bin/env node
/**
 * A citation with a stale line number is worse than no citation, because a
 * reader follows it and lands on unrelated code. Two kinds are checked here by
 * the same rule: the cited line must still CONTAIN the text the citation says
 * is there.
 *
 *   .tours/*.tour      every step carries an `anchor`
 *   the docs below     every citation is written `path:line anchor`
 *
 * A line number on its own proves only that the file is long enough — it goes
 * on passing while the citation points at the wrong symbol. The anchor is what
 * makes a citation falsifiable, so a citation without one is a failure.
 *
 *   node scripts/check-citations.mjs   (also runs as part of `npm run doctor`)
 */
import { readFileSync, readdirSync } from "node:fs";

// The docs the README hands a new reader. `docs/steering-review-2026-07-05.md`
// is deliberately out of scope: it is a dated snapshot of a tree that no longer
// exists, and says so at the top.
const DOCS = [
  "README.md",
  "docs/START_HERE.md",
  ...readdirSync("docs/codebase")
    .filter((f) => f.endsWith(".md"))
    .map((f) => `docs/codebase/${f}`),
];

// ponytail: a citation is only seen inside a `code span`. Every citation in
// these docs is written that way; a bare path:line in prose is invisible here.
const CITATION = /^([\w./-]+\.(?:ts|tsx|mjs)):(\d+)(?:\s+(.+))?$/;

let broken = 0;
let checked = 0;

function check(where, file, line, anchor) {
  checked += 1;
  let lines;
  try {
    lines = readFileSync(file, "utf8").split(/\r?\n/);
  } catch {
    console.error(`MISSING FILE  ${where}`);
    broken += 1;
    return;
  }
  if (!anchor) {
    console.error(`NO ANCHOR     ${where} (a line number alone cannot be verified)`);
    broken += 1;
    return;
  }
  if (lines[line - 1]?.includes(anchor)) return;
  const found = lines.findIndex((l) => l.includes(anchor));
  console.error(
    `WRONG LINE    ${where} — anchor ${JSON.stringify(anchor)} is ${found === -1 ? "gone" : `now on line ${found + 1}`}`,
  );
  broken += 1;
}

for (const name of readdirSync(".tours").filter((f) => f.endsWith(".tour"))) {
  const tour = JSON.parse(readFileSync(`.tours/${name}`, "utf8"));
  for (const [i, step] of tour.steps.entries()) {
    check(`${name} step ${i + 1} → ${step.file}:${step.line}`, step.file, step.line, step.anchor);
  }
}

for (const doc of DOCS) {
  for (const [, span] of readFileSync(doc, "utf8").matchAll(/`([^`\n]+)`/g)) {
    const cite = span.match(CITATION);
    if (cite) check(`${doc} → ${cite[1]}:${cite[2]}`, cite[1], Number(cite[2]), cite[3]);
  }
}

console.log(`${checked} citations checked, ${broken} broken`);
process.exit(broken ? 1 : 0);
