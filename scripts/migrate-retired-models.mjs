// Runs rooms:migrateRetiredRoomModels over EVERY page of `rooms` and `workers` and prints the
// totals. The deployment is never defaulted: `convex run` targets the DEV deployment unless told
// otherwise, so pass the selector yourself, e.g.  node scripts/migrate-retired-models.mjs --prod
// Run it after the deploy, then run it again: the second run must report migrated: 0 for both
// tables (that is the exhaustive stale-row check; `convex data` only lists the newest 100 rows).
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";

// The Convex CLI is run as `node <bin> ...`, never through a shell: on Windows cmd.exe strips the quotes
// from the JSON argument and `convex run` (JSON5) then rejects `{table:rooms,cursor:null}`.
// The package's `exports` hides bin/main.js, so locate it from package.json and its `bin` field.
export function convexBin() {
  const pkgPath = createRequire(import.meta.url).resolve("convex/package.json");
  const bin = JSON.parse(readFileSync(pkgPath, "utf8")).bin.convex;
  return join(dirname(pkgPath), bin);
}

/** Pages through one table until isDone, summing `migrated`. `run(args)` returns the parsed result. */
export async function migrateTable(run, table) {
  let cursor = null;
  let migrated = 0;
  let pages = 0;
  for (;;) {
    const page = await run({ table, cursor });
    migrated += page.migrated;
    pages += 1;
    if (page.isDone) return { table, migrated, pages };
    cursor = page.continueCursor;
  }
}

/** `convex run` prints strict JSON when stdout is not a TTY; function logs come first, so take the last top-level object. */
export function parseRunOutput(stdout) {
  const start = stdout.lastIndexOf("\n{") + 1;
  return JSON.parse(stdout.slice(start));
}

export function convexRun(selector, cli = convexBin()) {
  return (args) => {
    const r = spawnSync(process.execPath, [cli, "run", ...selector, "rooms:migrateRetiredRoomModels", JSON.stringify(args)], { encoding: "utf8" });
    if (r.error) throw r.error;
    if (r.status !== 0) throw new Error(`convex run failed (exit ${r.status}): ${r.stderr}`);
    return parseRunOutput(r.stdout);
  };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const selector = process.argv.slice(2);
  if (!selector.length) {
    console.error("Pass the deployment selector to convex run (e.g. --prod). Without one it would migrate your DEV deployment.");
    process.exit(2);
  }
  const run = convexRun(selector);
  for (const table of ["rooms", "workers"]) console.log(JSON.stringify(await migrateTable(run, table)));
}
