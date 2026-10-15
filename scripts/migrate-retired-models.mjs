// Runs rooms:migrateRetiredRoomModels over EVERY page of `rooms` and `workers` and prints the
// totals. The deployment is never defaulted: `convex run` targets the DEV deployment unless told
// otherwise, so pass an explicit selector (--prod, --deployment-name, --preview-name, or --url with
// --admin-key); any other argument list is refused before spawning, e.g.  node scripts/migrate-retired-models.mjs --prod
// It also refuses to run while CONVEX_DEPLOY_KEY / CONVEX_DEPLOYMENT_TOKEN is visible (env, .env.local, .env), because the
// CLI then silently ignores --prod and targets the key's deployment. Run it after the deploy, then run it again: the second run must report migrated: 0 for both
// tables (that is the exhaustive stale-row check; `convex data` only lists the newest 100 rows).
import { existsSync, readFileSync } from "node:fs";
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

/** `convex run` defaults to the DEV deployment, so refuse any argument list that does not name one explicitly. */
export function assertDeploymentSelector(args) {
  const has = (flag) => args.some((a) => a === flag || a.startsWith(`${flag}=`));
  const named = has("--prod") || has("--deployment-name") || has("--preview-name") || (has("--url") && has("--admin-key"));
  if (!named) {
    throw new Error("Pass an explicit deployment selector to convex run: --prod, --deployment-name <name>, --preview-name <name>, or --url <url> with --admin-key <key>. Without one it would migrate your DEV deployment.");
  }
}

/**
 * The Convex CLI reads CONVEX_DEPLOY_KEY / CONVEX_DEPLOYMENT_TOKEN from the environment, `.env.local` and `.env` (the
 * same sources, in the cwd) and, when it finds one, IGNORES --prod / --deployment-name / --preview-name and runs against
 * the key's deployment (stderr warning only, exit 0). So a flag selector cannot be trusted while a key is visible:
 * refuse instead of migrating, and proving clean, the wrong deployment. `--url` + `--admin-key` skips the key lookup.
 */
export function assertNoDeployKey(selector, { cwd = process.cwd(), env = process.env } = {}) {
  if (selector.some((a) => a === "--url" || a.startsWith("--url=")) && selector.some((a) => a === "--admin-key" || a.startsWith("--admin-key="))) return;
  const names = ["CONVEX_DEPLOY_KEY", "CONVEX_DEPLOYMENT_TOKEN"];
  const where = names.filter((n) => env[n]).map((n) => `${n} in the environment`);
  for (const file of [".env.local", ".env"]) {
    const path = join(cwd, file);
    if (!existsSync(path)) continue;
    const text = readFileSync(path, "utf8");
    for (const n of names) if (new RegExp(String.raw`^\s*(export\s+)?${n}\s*=\s*\S`, "m").test(text)) where.push(`${n} in ${file}`);
  }
  if (where.length) {
    throw new Error(`Refusing to run: ${where.join(", ")}. The Convex CLI would ignore the deployment flag and migrate the key's deployment instead. Unset/remove it, or select the deployment with --url <url> --admin-key <key>.`);
  }
}

export function convexRun(selector, cli = convexBin(), { cwd = process.cwd(), env = process.env } = {}) {
  assertDeploymentSelector(selector);
  assertNoDeployKey(selector, { cwd, env });
  return (args) => {
    const r = spawnSync(process.execPath, [cli, "run", ...selector, "rooms:migrateRetiredRoomModels", JSON.stringify(args)], { encoding: "utf8", cwd, env });
    if (r.error) throw r.error;
    if (r.status !== 0) throw new Error(`convex run failed (exit ${r.status}): ${r.stderr}`);
    // Backstop for any other way the CLI swaps the target: it only warns on stderr and exits 0.
    if (/Ignoring `--prod`/.test(r.stderr)) throw new Error(`convex run ignored the deployment selector, so nothing here can be trusted: ${r.stderr}`);
    if (r.stderr) process.stderr.write(r.stderr);
    return parseRunOutput(r.stdout);
  };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const selector = process.argv.slice(2);
  let run;
  try {
    run = convexRun(selector);
  } catch (e) {
    console.error(e.message);
    process.exit(2);
  }
  for (const table of ["rooms", "workers"]) console.log(JSON.stringify(await migrateTable(run, table)));
}
