#!/usr/bin/env node
/**
 * The four P0 probes, run against a server this script starts itself.
 *
 * A cold reader measured four defects on the running product. This script is
 * their reproduction, kept runnable so the numbers can be re-measured instead
 * of believed:
 *
 *   P1  an unbounded `turns` count on a public route allocates one step per
 *       turn, so a 3,000,000-turn request is a memory bomb
 *   P1b `/compare/demo` read the whole request body with no size cap, while
 *       the live path has capped at 20 MB all along
 *   P2  `target` reached `RoomState.task.target` (typed `number`) unvalidated,
 *       so a string came back out of the API and `current >= "abc"` was never
 *       true — the room could never complete
 *   P3  provenance was computed before the run, so a run whose OpenAI calls
 *       failed mid-way still reported `mode:"openai"` and "live"
 *   P4  a bare `catch { return deterministic; }` presented the fallback as a
 *       model result, with nothing recorded anywhere
 *
 * Run it on the pre-fix tree and on the fixed tree and diff the two files:
 *
 *   npx tsx scripts/prove-p0-boundary.ts --label=before --out=promotion/evidence/p0-boundary/before.json
 *   npx tsx scripts/prove-p0-boundary.ts --label=after  --out=promotion/evidence/p0-boundary/after.json
 *   node -e "…" # or just read the two JSON files
 *
 * PORT defaults to 4701. The server is started fresh here on purpose: evidence
 * from a process older than the change is evidence about a tree that no longer
 * exists.
 */
import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { createVoiceRoom } from "../src/core/roomReducer.js";
import { runVoiceStep } from "../src/voice/voiceAgent.js";
import { runSideBySideComparison } from "../src/compare/badGoodDemo.js";

const repoRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const arg = (name: string, fallback: string): string =>
  process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback;

const PORT = Number(process.env.PORT ?? arg("port", "4701"));
const LABEL = arg("label", "unlabelled");
const OUT = resolve(repoRoot, arg("out", `promotion/evidence/p0-boundary/${LABEL}.json`));
const BASE = `http://127.0.0.1:${PORT}`;

// ── process helpers ───────────────────────────────────────────────────
/** Working-set bytes for a pid, in MB. Returns null if the process is gone. */
function rssMB(pid: number): number | null {
  try {
    if (process.platform === "win32") {
      const row = execFileSync("tasklist", ["/FI", `PID eq ${pid}`, "/FO", "CSV", "/NH"], { encoding: "utf8" });
      const kb = row.match(/"([\d,]+) K"\s*$/m)?.[1];
      return kb ? Number(kb.replace(/,/g, "")) / 1024 : null;
    }
    const kb = execFileSync("ps", ["-o", "rss=", "-p", String(pid)], { encoding: "utf8" }).trim();
    return kb ? Number(kb) / 1024 : null;
  } catch {
    return null;
  }
}

function listenerPid(port: number): number | null {
  try {
    if (process.platform === "win32") {
      const out = execFileSync("netstat", ["-ano", "-p", "tcp"], { encoding: "utf8" });
      const line = out.split(/\r?\n/).find((l) => l.includes("LISTENING") && new RegExp(`:${port}\\b`).test(l));
      const pid = line?.trim().split(/\s+/).pop();
      return pid ? Number(pid) : null;
    }
    const out = execFileSync("lsof", ["-ti", `tcp:${port}`], { encoding: "utf8" }).trim().split(/\s+/)[0];
    return out ? Number(out) : null;
  } catch {
    return null;
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function waitForHealth(timeoutMs = 90_000): Promise<unknown> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${BASE}/health`);
      if (res.ok) return await res.json();
    } catch {
      /* not up yet */
    }
    await sleep(300);
  }
  throw new Error(`server did not answer /health on ${BASE} within ${timeoutMs} ms`);
}

/** Poll the server's RSS while `work` runs; return its result and the peak. */
async function withRssPeak<T>(pid: number | null, work: () => Promise<T>): Promise<{ result: T; peakRssMB: number | null }> {
  let peak = pid === null ? null : rssMB(pid);
  let polling = true;
  const poller = (async () => {
    while (polling && pid !== null) {
      const now = rssMB(pid);
      if (now !== null) peak = peak === null ? now : Math.max(peak, now);
      await sleep(50);
    }
  })();
  try {
    const result = await work();
    return { result, peakRssMB: peak === null ? null : Number(peak.toFixed(1)) };
  } finally {
    polling = false;
    await poller;
  }
}

/** Read a response without ever holding it in memory: bytes + a streaming
 *  count of `"turn":` keys, which is one per returned step. */
async function drain(res: Response): Promise<{ bytes: number; steps: number; head: string }> {
  const reader = res.body?.getReader();
  const decoder = new TextDecoder();
  let bytes = 0;
  let steps = 0;
  let head = "";
  let carry = "";
  while (reader) {
    const { done, value } = await reader.read();
    if (done) break;
    bytes += value.byteLength;
    const text = carry + decoder.decode(value, { stream: true });
    steps += (text.match(/"turn":/g) ?? []).length;
    carry = text.slice(-8);
    if (head.length < 400) head += text.slice(0, 400 - head.length);
  }
  return { bytes, steps, head };
}

async function postJson(body: unknown): Promise<Response> {
  return fetch(`${BASE}/compare/demo`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

// ── the probes ────────────────────────────────────────────────────────
const probes: Record<string, unknown> = {};

async function httpProbes(pid: number | null): Promise<void> {
  // P2 — an unvalidated string crosses the boundary into a `number` field.
  {
    const res = await postJson({ target: "abc" });
    const payload = (await res.json()) as { goodFinalState?: { task?: Record<string, unknown> } };
    const task = payload.goodFinalState?.task ?? {};
    probes.P2_target_string = {
      probe: `POST /compare/demo {"target":"abc"}`,
      status: res.status,
      taskTargetType: typeof task.target,
      taskTarget: task.target,
      taskCompleted: task.completed,
    };
  }
  // P2b — the same hole with a number the room cannot survive either.
  {
    const res = await postJson({ target: 1e9, turns: 5 });
    const payload = (await res.json()) as { goodFinalState?: { task?: Record<string, unknown> } };
    probes.P2b_target_huge = {
      probe: `POST /compare/demo {"target":1e9,"turns":5}`,
      status: res.status,
      taskTarget: payload.goodFinalState?.task?.target,
    };
  }
  // P2c — a room that CAN complete once target is a real number again.
  {
    const res = await postJson({ target: "abc", turns: 20 });
    const payload = (await res.json()) as { goodFinalState?: { task?: Record<string, unknown> } };
    probes.P2c_completes_after_narrowing = {
      probe: `POST /compare/demo {"target":"abc","turns":20}`,
      status: res.status,
      taskTarget: payload.goodFinalState?.task?.target,
      taskCurrent: payload.goodFinalState?.task?.current,
      taskCompleted: payload.goodFinalState?.task?.completed,
    };
  }
  // P1b — body-size cap. 25 MB is above the live path's 20 MB cap.
  {
    const pad = "x".repeat(25 * 1024 * 1024);
    const started = Date.now();
    const { result, peakRssMB } = await withRssPeak(pid, async () => {
      try {
        const res = await postJson(JSON.stringify({ target: 12, turns: 1, source: "deterministic", pad }));
        const text = (await res.text()).slice(0, 200);
        return { status: res.status, head: text };
      } catch (err) {
        return { status: "transport_error", head: String(err).slice(0, 200) };
      }
    });
    probes.P1b_body_cap = {
      probe: "POST /compare/demo with a 25 MB JSON body (live path caps at 20 MB)",
      bodyBytes: 25 * 1024 * 1024,
      ...result,
      elapsedMs: Date.now() - started,
      serverPeakRssMB: peakRssMB,
    };
  }
  // P1c — the sibling route. /voice/demo stops when the task completes, so an
  // unbounded `turns` alone is harmless there; combined with a `target` the
  // room can never reach, it is the same bomb.
  {
    const started = Date.now();
    const { result, peakRssMB } = await withRssPeak(pid, async () => {
      try {
        const res = await fetch(`${BASE}/voice/demo`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ target: "abc", turns: 20_000 }),
        });
        const drained = await drain(res);
        return { status: res.status, responseBytes: drained.bytes };
      } catch (err) {
        return { status: "transport_error", error: String(err).slice(0, 200) };
      }
    });
    probes.P1c_voice_demo_sibling = {
      probe: `POST /voice/demo {"target":"abc","turns":20000}`,
      ...result,
      elapsedMs: Date.now() - started,
      serverPeakRssMB: peakRssMB,
    };
  }
  // P1 — the memory bomb. This is the cold reader's exact probe.
  {
    const started = Date.now();
    const { result, peakRssMB } = await withRssPeak(pid, async () => {
      try {
        const res = await postJson({ turns: 3_000_000 });
        const drained = await drain(res);
        return { status: res.status, responseBytes: drained.bytes, stepsReturned: drained.steps };
      } catch (err) {
        return { status: "transport_error", error: String(err).slice(0, 200) };
      }
    });
    probes.P1_turns_flood = {
      probe: `POST /compare/demo {"turns":3000000}`,
      ...result,
      elapsedMs: Date.now() - started,
      serverPeakRssMB: peakRssMB,
    };
  }
}

/** P3 — provenance after a mid-run provider failure (no network needed). */
async function provenanceProbe(): Promise<void> {
  const realFetch = globalThis.fetch;
  const previousKey = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = "test-key-p0-probe";
  const turns = 3;
  let calls = 0;
  let failed = 0;
  globalThis.fetch = (async () => {
    calls += 1;
    // The bad side runs first and gets `turns` real answers; then the provider
    // goes down, which is exactly the case the authors' own comment covers.
    if (calls <= turns) {
      return new Response(JSON.stringify({ choices: [{ message: { content: "Yeah exactly, let's do that!" } }] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    failed += 1;
    throw new Error("simulated provider outage mid-run");
  }) as typeof fetch;

  try {
    const result = await runSideBySideComparison({ target: 3, turns, source: "openai" });
    probes.P3_provenance_after_midrun_failure = {
      probe: "runSideBySideComparison({source:'openai'}) with the provider failing after the bad side",
      openaiCalls: calls,
      openaiCallsFailed: failed,
      provenance: result.provenance,
      goodTexts: result.good.map((s) => s.text),
      goodStepCount: result.good.length,
    };
  } catch (err) {
    probes.P3_provenance_after_midrun_failure = {
      probe: "runSideBySideComparison({source:'openai'}) with the provider failing after the bad side",
      openaiCalls: calls,
      openaiCallsFailed: failed,
      threw: String(err).slice(0, 200),
    };
  } finally {
    globalThis.fetch = realFetch;
    if (previousKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = previousKey;
  }
}

/** P4 — a provider error with no key set, swallowed and committed as a turn. */
async function swallowProbe(): Promise<void> {
  const previousKey = process.env.OPENAI_API_KEY;
  delete process.env.OPENAI_API_KEY; // openaiChat throws before any network call
  const warnings: string[] = [];
  const realWarn = console.warn;
  console.warn = (...args: unknown[]) => {
    warnings.push(args.map(String).join(" "));
  };
  let reported = 0;
  let threw: string | null = null;
  let state = createVoiceRoom(5);
  try {
    state = await runVoiceStep(state, {
      actorId: "voice-a",
      label: "voice-a",
      source: "openai",
      // present on the fixed tree, ignored on the pre-fix tree
      onProviderError: () => {
        reported += 1;
      },
    } as Parameters<typeof runVoiceStep>[1]);
  } catch (err) {
    threw = String(err).slice(0, 200);
  } finally {
    console.warn = realWarn;
    if (previousKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = previousKey;
  }
  const last = state.utterances.at(-1);
  probes.P4_silent_provider_swallow = {
    probe: "runVoiceStep({source:'openai'}) with OPENAI_API_KEY unset",
    threw,
    committedText: last?.text ?? null,
    committedSpeechAct: last?.speechAct ?? null,
    taskCurrent: state.task.kind === "count_to_n" ? state.task.current : null,
    fallbackReportedToCaller: reported,
    warningsLogged: warnings.length,
    firstWarning: warnings[0]?.slice(0, 160) ?? null,
  };
}

// ── run ───────────────────────────────────────────────────────────────
let child: ChildProcess | null = null;
try {
  child = spawn("npx", ["tsx", "src/server.ts"], {
    cwd: repoRoot,
    env: { ...process.env, PORT: String(PORT), OPENAI_API_KEY: "", ELEVENLABS_API_KEY: "" },
    stdio: "ignore",
    shell: process.platform === "win32",
  });
  const health = await waitForHealth();
  const pid = listenerPid(PORT);
  probes.server = { port: PORT, pid, health, idleRssMB: pid === null ? null : rssMB(pid) };

  await httpProbes(pid);
  await provenanceProbe();
  await swallowProbe();
} finally {
  if (child) {
    if (process.platform === "win32" && child.pid) {
      try {
        execFileSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], { stdio: "ignore" });
      } catch {
        /* already gone */
      }
    } else {
      child.kill("SIGKILL");
    }
  }
}

const commit = (() => {
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], { cwd: repoRoot, encoding: "utf8" }).trim();
  } catch {
    return null;
  }
})();

const report = { label: LABEL, capturedAt: new Date().toISOString(), commit, node: process.version, probes };
mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report, null, 2));
console.log(`\nwrote ${OUT}`);
