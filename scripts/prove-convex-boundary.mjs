#!/usr/bin/env node
/**
 * The same P0 boundary probes as `scripts/prove-p0-boundary.ts`, issued against
 * a REAL Convex deployment instead of the Node server.
 *
 * Iteration 4 closed D10 — `convex/http.ts` is a second complete copy of the
 * public API, and every route in it read its body with a bare `req.json()` — but
 * closed it at code level only: no request was ever sent to a running Convex
 * deployment, so "the hosted /compare/demo answers 413 to a 25 MB body" was a
 * claim about a code path, not a measurement. This script is the missing half.
 *
 * It measures three things the Node twin proved in iterations 2-3, on the copy a
 * permanent URL actually serves:
 *
 *   C1  a 25 MB body            -> 413 `body too large`  (the cap, not a parse)
 *   C2  {"target":"abc"}        -> task.target is a NUMBER, and the room can complete
 *   C3  {"turns":3000000}       -> clamped to MAX_RUN_TURNS, not a 3-million-step run
 *   C4  the shipped default run -> unchanged (100/100, completed)
 *   C5  unparseable JSON        -> 400, not silently rounded to `{}`
 *
 * There is no RSS column here and that is deliberate: the process is Convex's,
 * on Convex's machine, and this script cannot sample it. What it can measure is
 * the status, the returned values and the elapsed time, which is what the three
 * defects were about.
 *
 * Setup (an ISOLATED dev deployment; never production):
 *
 *   npx convex dev --once --configure new --project nodevoice-live --team <team>
 *   node scripts/prove-convex-boundary.mjs --out=promotion/evidence/convex-live/convex-boundary.json
 *
 * The base URL comes from `CONVEX_SITE_URL`, else `VITE_CONVEX_SITE_URL` in the
 * gitignored `.env.local` that `convex dev` writes. Nothing secret is read: the
 * routes probed are public and take no key.
 *
 * Exits non-zero if any expectation fails, so a regression is a failed run
 * rather than a JSON file somebody has to re-read.
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const arg = (name, fallback) =>
  process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback;

const OUT = resolve(repoRoot, arg("out", "promotion/evidence/convex-live/convex-boundary.json"));

function siteUrl() {
  if (process.env.CONVEX_SITE_URL) return process.env.CONVEX_SITE_URL.replace(/\/$/, "");
  try {
    const env = readFileSync(resolve(repoRoot, ".env.local"), "utf8");
    const hit = env.match(/^VITE_CONVEX_SITE_URL=(.*)$/m)?.[1]?.trim();
    if (hit) return hit.replace(/\/$/, "");
  } catch {
    /* fall through to the error below */
  }
  throw new Error("no CONVEX_SITE_URL and no VITE_CONVEX_SITE_URL in .env.local — run `npx convex dev --once` first");
}

const BASE = siteUrl();
const post = (path, body, headers = {}) =>
  fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });

/** Response bytes + a streaming count of `"turn":` keys (one per step), without
 *  ever holding the whole body in memory — a flood must not OOM the prober.
 *
 *  The carry is NEEDLE.length - 1 and no longer. A match that straddles a chunk
 *  boundary starts in the carry and must be counted; a match that fits ENTIRELY
 *  inside the carry would be counted twice, once in its own chunk and again on
 *  the next. Six characters cannot hold a seven-character needle, so that case
 *  cannot arise. Measured: an 8-char carry reported 421 steps where 420 were
 *  returned, and which number you got depended on where the network split the
 *  chunks. */
const NEEDLE = '"turn":';
async function drain(res) {
  const reader = res.body?.getReader();
  const decoder = new TextDecoder();
  let bytes = 0;
  let steps = 0;
  let carry = "";
  while (reader) {
    const { done, value } = await reader.read();
    if (done) break;
    bytes += value.byteLength;
    const text = carry + decoder.decode(value, { stream: true });
    steps += text.split(NEEDLE).length - 1;
    carry = text.slice(-(NEEDLE.length - 1));
  }
  return { bytes, steps };
}

const probes = {};
const failures = [];
const expect = (name, actual, wanted) => {
  if (actual !== wanted) failures.push(`${name}: expected ${JSON.stringify(wanted)}, got ${JSON.stringify(actual)}`);
};
const timed = async (work) => {
  const started = Date.now();
  const result = await work();
  return { ...result, elapsedMs: Date.now() - started };
};

/**
 * An over-cap upload three times over, because refusing one is not always the
 * same shape twice.
 *
 * Cancelling the request stream is how a web `Request` says "stop sending", and
 * a client still uploading when that lands can see the connection reset before
 * it reads the response — the same race iteration 2 measured on the Node reader
 * and answered there with a bounded drain. A web stream has no drain, so the
 * refusal is a readable 413 on some runs and a `transport_error` on others.
 *
 * The claim is therefore stated as what actually matters and is stable: NO
 * attempt is accepted. That is not a loosened assertion — the pre-fix tree
 * answers 200 to every one of these and, on `/live/rooms`, creates a room, so a
 * regression fails this on all three attempts, not on a flaky one.
 */
const overCap = async (path, extra) => {
  const pad = "x".repeat(25 * 1024 * 1024);
  const attempts = [];
  for (let i = 0; i < 3; i += 1) {
    const started = Date.now();
    try {
      const res = await post(path, JSON.stringify({ ...extra, pad }));
      attempts.push({ status: res.status, head: (await res.text()).slice(0, 160), elapsedMs: Date.now() - started });
    } catch (err) {
      attempts.push({ status: "transport_error", head: String(err).slice(0, 160), elapsedMs: Date.now() - started });
    }
  }
  return {
    probe: `POST ${path} with a 25 MB JSON body, x3`,
    bodyBytes: 25 * 1024 * 1024,
    attempts,
    accepted: attempts.filter((a) => typeof a.status === "number" && a.status < 400).length,
    read413: attempts.filter((a) => a.status === 413).length,
    connectionReset: attempts.filter((a) => a.status === "transport_error").length,
  };
};

// C1 — the 20 MB body cap, on the hosted copy. 25 MB is above it.
probes.C1_body_cap_25mb = await overCap("/compare/demo", { target: 12, turns: 1, source: "deterministic" });
expect("C1 accepted", probes.C1_body_cap_25mb.accepted, 0);

// C2 — a string in a field typed `number`. Before iteration 4 this came straight
// back out of the hosted API and the room could never complete.
probes.C2_target_string = await timed(async () => {
  const res = await post("/compare/demo", { target: "abc" });
  const payload = await res.json();
  const task = payload.goodFinalState?.task ?? {};
  return {
    probe: `POST /compare/demo {"target":"abc"}`,
    status: res.status,
    taskTargetType: typeof task.target,
    taskTarget: task.target,
    taskCurrent: task.current,
    taskCompleted: task.completed,
  };
});
expect("C2 taskTargetType", probes.C2_target_string.taskTargetType, "number");
expect("C2 taskTarget", probes.C2_target_string.taskTarget, 100);
expect("C2 taskCompleted", probes.C2_target_string.taskCompleted, true);

// C2b — a number the room cannot survive either, clamped by MAX_COUNT_TARGET.
probes.C2b_target_huge = await timed(async () => {
  const res = await post("/compare/demo", { target: 1e9, turns: 5 });
  const payload = await res.json();
  return { probe: `POST /compare/demo {"target":1e9,"turns":5}`, status: res.status, taskTarget: payload.goodFinalState?.task?.target };
});
expect("C2b taskTarget", probes.C2b_target_huge.taskTarget, 300);

// C3 — the memory bomb. One step per requested turn, three private-state
// snapshots each, on a route with `access-control-allow-origin: *`.
probes.C3_turns_flood = await timed(async () => {
  try {
    const res = await post("/compare/demo", { turns: 3_000_000 });
    const drained = await drain(res);
    return { probe: `POST /compare/demo {"turns":3000000}`, status: res.status, responseBytes: drained.bytes, stepsReturned: drained.steps };
  } catch (err) {
    return { probe: `POST /compare/demo {"turns":3000000}`, status: "transport_error", error: String(err).slice(0, 200) };
  }
});
expect("C3 status", probes.C3_turns_flood.status, 200);
// 320 bad steps (MAX_RUN_TURNS) + 100 good steps (min(turns, target)) = 420.
expect("C3 stepsReturned", probes.C3_turns_flood.stepsReturned, 420);

// C4 — the shipped default. A bound that breaks the product is not a fix.
probes.C4_shipped_default = await timed(async () => {
  const res = await post("/compare/demo", { target: 100, turns: 100, source: "deterministic" });
  const payload = await res.json();
  return {
    probe: `POST /compare/demo {"target":100,"turns":100,"source":"deterministic"}`,
    status: res.status,
    goodSteps: payload.good?.length,
    badSteps: payload.bad?.length,
    task: payload.goodFinalState?.task,
    provenanceGood: payload.provenance?.good,
  };
});
expect("C4 status", probes.C4_shipped_default.status, 200);
expect("C4 goodSteps", probes.C4_shipped_default.goodSteps, 100);
expect("C4 task.completed", probes.C4_shipped_default.task?.completed, true);
expect("C4 task.current", probes.C4_shipped_default.task?.current, 100);

// C5 — unparseable JSON used to be rounded to `{}` and the route carried on.
probes.C5_unparseable_json = await timed(async () => {
  const res = await post("/compare/demo", "{not json");
  return { probe: "POST /compare/demo with a body that is not JSON", status: res.status, head: (await res.text()).slice(0, 200) };
});
expect("C5 status", probes.C5_unparseable_json.status, 400);

// C6 — the cap belongs to the file, not to one route. /live/rooms goes through
// the same `body()` helper, and it is the route with a side effect: pre-fix, a
// 25 MB body was accepted and a room was WRITTEN.
probes.C6_live_rooms_body_cap = await overCap("/live/rooms", { goal: "count to 10" });
expect("C6 accepted", probes.C6_live_rooms_body_cap.accepted, 0);

const commit = (() => {
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], { cwd: repoRoot, encoding: "utf8" }).trim();
  } catch {
    return null;
  }
})();

const report = {
  label: arg("label", "convex-live"),
  capturedAt: new Date().toISOString(),
  commit,
  node: process.version,
  target: {
    runtime: "Convex httpAction (hosted)",
    // The deployment host is redacted on purpose, and nothing is hidden by it:
    // these routes are public and unauthenticated, so a live dev URL in a public
    // repo is a write endpoint anyone can drive. Re-running this file does not
    // need the host either — `npx convex dev --once --configure new` gives the
    // verifier their own, and the script reads it from their own .env.local.
    baseUrl: BASE.replace(/^https:\/\/[^.]+\./, "https://<dev-deployment>."),
    note: "Isolated Convex DEV deployment created for this probe; never production. No RSS column: the process is Convex's and this script cannot sample it.",
  },
  expectationFailures: failures,
  probes,
};
mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report, null, 2));
console.log(`\nwrote ${OUT}`);
if (failures.length) {
  console.error(`\n${failures.length} expectation(s) failed:\n  ${failures.join("\n  ")}`);
  process.exit(1);
}
