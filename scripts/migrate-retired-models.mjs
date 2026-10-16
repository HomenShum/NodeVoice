// Runs rooms:migrateRetiredRoomModels over EVERY page of `rooms` and `workers` and prints the
// totals. The deployment is never defaulted: `convex run` targets the DEV deployment unless told
// otherwise, so pass an explicit selector (--prod, --deployment-name, --preview-name, or --url with
// --admin-key); any other argument list is refused before spawning, e.g.  node scripts/migrate-retired-models.mjs --prod
// It also refuses --env-file, and refuses to run while CONVEX_DEPLOY_KEY / CONVEX_DEPLOYMENT_TOKEN is visible (env, .env.local, .env), because the
// CLI then silently ignores --prod and targets the key's deployment. Run it after the deploy, then run it again: the second run must report migrated: 0 for both
// tables (that is the exhaustive stale-row check; `convex data` only lists the newest 100 rows).
// `--live-rooms <selector>` is runbook step 1: it lists the running rooms through the same guards, because `convex data` also obeys a visible deploy key.
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

// The Convex CLI's bundled dotenv@16.6.1 parse (cli.bundle.cjs, require_main), copied so the preflight sees the values the CLI
// would see: an empty value (K=, K="", K= # note) is unset, and a later line for the same key wins.
const DOTENV_LINE = /(?:^|^)\s*(?:export\s+)?([\w.-]+)(?:\s*=\s*?|:\s+?)(\s*'(?:\\'|[^'])*'|\s*"(?:\\"|[^"])*"|\s*`(?:\\`|[^`])*`|[^#\r\n]+)?\s*(?:#.*)?(?:$|$)/gm;
function dotenvParse(src) {
  const obj = {};
  for (const m of src.replace(/\r\n?/gm, "\n").matchAll(DOTENV_LINE)) {
    let value = (m[2] || "").trim();
    const quote = value[0];
    value = value.replace(/^(['"`])([\s\S]*)\1$/gm, "$2");
    if (quote === '"') value = value.replace(/\\n/g, "\n").replace(/\\r/g, "\r");
    obj[m[1]] = value;
  }
  return obj;
}

/**
 * The Convex CLI reads CONVEX_DEPLOY_KEY / CONVEX_DEPLOYMENT_TOKEN from the environment, `.env.local` and `.env` (the
 * same sources, in the cwd) and, when it finds one, IGNORES --prod / --deployment-name / --preview-name and runs against
 * the key's deployment (stderr warning only, exit 0). So a flag selector cannot be trusted while a key is visible:
 * refuse instead of migrating, and proving clean, the wrong deployment. `--url` + `--admin-key` skips the key lookup.
 * The file scan below runs the CLI's own dotenv line grammar (`KEY=v`, `KEY: v`, optional `export`) and flags only non-empty
 * values, to fail fast with a readable message; convexRun's blanked child env is what actually keeps a key the scan misses from taking effect.
 */
export function assertNoDeployKey(selector, { cwd = process.cwd(), env = process.env } = {}) {
  // `--env-file <file>` is a fourth key source the CLI reads (and obeys) before any selector; it is not inspected here, so refuse it.
  if (selector.some((a) => a === "--env-file" || a.startsWith("--env-file="))) {
    throw new Error("Refusing to run: --env-file can carry a CONVEX_DEPLOY_KEY that makes the CLI ignore the deployment flag and migrate the key's deployment. Drop it and select the deployment with --prod / --deployment-name / --preview-name, or --url <url> --admin-key <key>.");
  }
  if (selector.some((a) => a === "--url" || a.startsWith("--url=")) && selector.some((a) => a === "--admin-key" || a.startsWith("--admin-key="))) return;
  const names = ["CONVEX_DEPLOY_KEY", "CONVEX_DEPLOYMENT_TOKEN"];
  const where = names.filter((n) => env[n]).map((n) => `${n} in the environment`);
  for (const file of [".env.local", ".env"]) {
    const path = join(cwd, file);
    if (!existsSync(path)) continue;
    const text = readFileSync(path, "utf8");
    const parsed = dotenvParse(text);
    for (const n of names) if (parsed[n]) where.push(`${n} in ${file}`);
  }
  if (where.length) {
    throw new Error(`Refusing to run: ${where.join(", ")}. The Convex CLI would ignore the deployment flag and migrate the key's deployment instead. Unset/remove it, or select the deployment with --url <url> --admin-key <key>.`);
  }
}

/** Guards every spawn the same way: a named deployment, no visible deploy key, blanked key env, and a fail on the CLI's "Ignoring" warning. Returns exec(argv) -> stdout. */
function convexExec(selector, cli, { cwd, env }) {
  assertDeploymentSelector(selector);
  assertNoDeployKey(selector, { cwd, env });
  return (argv) => {
    // The CLI loads .env.local/.env with dotenv, which never overrides a variable that already exists, and treats "" as unset:
    // blanking both here shadows any file key whatever its syntax, so the preflight above is a fail-fast message, not the guarantee.
    const childEnv = { ...env, CONVEX_DEPLOY_KEY: "", CONVEX_DEPLOYMENT_TOKEN: "" };
    const r = spawnSync(process.execPath, [cli, ...argv], { encoding: "utf8", cwd, env: childEnv, maxBuffer: 1 << 30 });
    if (r.error) throw r.error;
    if (r.status !== 0) throw new Error(`convex ${argv[0]} failed (exit ${r.status}): ${r.stderr}`);
    // Backstop for any other way the CLI swaps the target: it only warns on stderr and exits 0.
    if (/Ignoring `--prod`/.test(r.stderr)) throw new Error(`convex ${argv[0]} ignored the deployment selector, so nothing here can be trusted: ${r.stderr}`);
    if (r.stderr) process.stderr.write(r.stderr);
    return r.stdout;
  };
}

export function convexRun(selector, cli = convexBin(), { cwd = process.cwd(), env = process.env } = {}) {
  const exec = convexExec(selector, cli, { cwd, env });
  return (args) => parseRunOutput(exec(["run", ...selector, "rooms:migrateRetiredRoomModels", JSON.stringify(args)]));
}

/**
 * Runbook step 1 (SPEC A.2.5, live rooms are checked before removal): the rooms with `running: true`. It goes through the same
 * guards as convexRun because `convex data` shares the CLI's deployment selection, so a visible deploy key would otherwise make it
 * list ANOTHER deployment's rooms. `convex data` keeps only the newest `limit` rooms and `jsonl` prints no truncation warning,
 * so a result that fills the limit is refused: raise the limit.
 */
export function liveRooms(selector, cli = convexBin(), { cwd = process.cwd(), env = process.env, limit = 100000 } = {}) {
  const exec = convexExec(selector, cli, { cwd, env });
  const lines = exec(["data", "rooms", ...selector, "--format", "jsonl", "--limit", String(limit)]).split("\n").filter((l) => l.trim());
  if (lines.length >= limit) throw new Error(`convex data returned ${lines.length} rooms, the --limit: the list may be cut off. Raise the limit.`);
  return lines.map((l) => JSON.parse(l)).filter((room) => room.running === true);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const live = process.argv[2] === "--live-rooms";
  const selector = process.argv.slice(live ? 3 : 2);
  try {
    if (live) {
      const running = liveRooms(selector);
      console.log(JSON.stringify({ running: running.length, codes: running.map((r) => r.code ?? r._id) }));
    } else {
      const run = convexRun(selector);
      for (const table of ["rooms", "workers"]) console.log(JSON.stringify(await migrateTable(run, table)));
    }
  } catch (e) {
    console.error(e.message);
    process.exit(2);
  }
}
