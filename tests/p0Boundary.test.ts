/**
 * Four defects a cold reader measured against the running server, each pinned
 * here so it cannot come back quietly. Every test in this file fails on the
 * pre-fix tree (see promotion/PROMOTION_LOG.md for the stash-and-rerun record).
 *
 *   1. `{"turns":3000000}` on a public route allocated one step per turn
 *   2. `{"target":"abc"}` reached `task.target` (typed `number`), and
 *      `current >= "abc"` is never true, so the room could never complete
 *   3. provenance was written before the run, so a mid-run provider failure
 *      still reported `mode:"openai"` and "live"
 *   4. a bare `catch { return deterministic; }` presented the fallback as a
 *      model result with nothing recorded anywhere
 *
 * And one an adversarial verifier found afterwards, in the guard itself: the
 * anti-enumeration walk covered `src/` only, so `convex/http.ts` — a second
 * complete implementation of the same public routes — kept an uncapped
 * `req.json()` on every POST while the tree "proved" one reader with one cap.
 */
import { readdirSync, readFileSync } from "node:fs";
import { PassThrough, Readable } from "node:stream";
import type { IncomingMessage } from "node:http";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MAX_RUN_TURNS, validTurns } from "../src/core/agents.js";
import { MAX_COUNT_TARGET, validCountTarget } from "../src/core/steering.js";
import { createVoiceRoom } from "../src/core/roomReducer.js";
import { runSideBySideComparison } from "../src/compare/badGoodDemo.js";
import { runVoiceStep } from "../src/voice/voiceAgent.js";
import { readJson } from "../src/live/roomServer.js";
import { MAX_BODY_BYTES, readBoundedBody, readJsonRequest } from "../src/core/requestBody.js";
import * as convexShared from "../convex/shared.js";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function okResponse(content: string): Response {
  return new Response(JSON.stringify({ choices: [{ message: { content } }] }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

describe("P1 — a requested count cannot allocate without a bound", () => {
  it("clamps a three-million-turn request to the run cap the live room already uses", async () => {
    const result = await runSideBySideComparison({ turns: 3_000_000, target: 12, source: "deterministic" });
    expect(result.bad.length).toBe(MAX_RUN_TURNS);
    expect(result.bad.length).toBeLessThanOrEqual(MAX_RUN_TURNS);
    expect(result.good.length).toBeLessThanOrEqual(MAX_RUN_TURNS);
  });

  it("keeps every turn count finite and non-negative", () => {
    expect(validTurns(3_000_000, 9)).toBe(MAX_RUN_TURNS);
    expect(validTurns(-5, 9)).toBe(0);
    expect(validTurns("abc", 9)).toBe(9);
    expect(validTurns(Number.NaN, 9)).toBe(9);
    expect(validTurns(undefined, 20)).toBe(20);
    expect(validTurns(12, 9)).toBe(12); // ordinary requests are untouched
  });
});

describe("P1b — one body-size cap, shared with the live path", () => {
  const bodyOf = (bytes: number): IncomingMessage =>
    Readable.from([Buffer.alloc(bytes, "x")]) as unknown as IncomingMessage;

  it("rejects a body over the cap instead of buffering it", async () => {
    await expect(readJson(bodyOf(21 * 1024 * 1024))).rejects.toThrow(/body too large/);
  });

  it("still reads an ordinary body", async () => {
    const req = Readable.from([Buffer.from(JSON.stringify({ target: 12 }))]) as unknown as IncomingMessage;
    await expect(readJson<{ target: number }>(req)).resolves.toEqual({ target: 12 });
  });

  it("answers a client that crosses the cap and then stops sending", async () => {
    // No `end`, ever — the shape a raw socket produces when it declares a
    // gigabyte, writes 21 MB and goes quiet. The reader used to wait for an
    // `end` that never came, holding the socket for Node's 300 s
    // `requestTimeout`; it must refuse on its own.
    const req = new PassThrough();
    req.write(Buffer.alloc(21 * 1024 * 1024, "x"));
    const started = Date.now();
    await expect(readJson(req as unknown as IncomingMessage)).rejects.toThrow(/body too large/);
    expect(Date.now() - started).toBeLessThan(5_000);
    req.destroy();
  });

  it("finds no third request-body reader that could carry a different cap", () => {
    // Discovered, not listed, twice now. `src/server.ts` once had its own
    // uncapped copy of this reader — a guard that consults a list of known
    // callers cannot see the one nobody remembered, so this walks the tree.
    // Then the walk itself turned out to be the list: it covered `src/` only,
    // and `convex/http.ts` is a SECOND COMPLETE IMPLEMENTATION of the same
    // public API (POST /compare/demo, /nodeagents/run, /live/rooms and
    // /live/rooms/*) whose every route read its body with an uncapped
    // `req.json()`. Both roots are walked now, and the detector knows the web
    // `Request` shapes as well as the `node:http` stream ones.
    const roots = ["../src/", "../convex/"].map((r) => fileURLToPath(new URL(r, import.meta.url)).replace(/\\/g, "/"));
    const files = roots.flatMap((root) =>
      readdirSync(root, { recursive: true, encoding: "utf8" })
        .map((name) => `${root}${name.replace(/\\/g, "/")}`)
        .filter((file) => file.endsWith(".ts") && !file.includes("/_generated/")),
    );
    const srcRoot = roots[0]!;
    const convexRoot = roots[1]!;
    expect(files.length).toBeGreaterThan(20); // the scan walked a tree, not an empty dir
    expect(files).toContain(`${srcRoot}live/roomServer.ts`); // the node:http reader
    expect(files).toContain(`${srcRoot}core/requestBody.ts`); // the web Request reader
    expect(files).toContain(`${convexRoot}http.ts`); // and the router the walk used to miss

    // One legal reader per stream type; both take their cap from
    // src/core/requestBody.ts, so neither can drift from the other.
    const legal = [`${srcRoot}live/roomServer.ts`, `${srcRoot}core/requestBody.ts`];
    // `req.json()` and friends consume a whole body with no cap at all — the
    // exact shape the previous detector, which only knew `.on("data")` and
    // `for await`, let through.
    const READS_A_BODY =
      /\b(?:req|request)\s*\.\s*(?:json|text|arrayBuffer|formData|blob|bytes)\s*\(|\.on\(\s*["']data["']|for await\s*\([^)]*\bof\s+(?:req|request)\b/;
    const readsRequestBodies = files
      .filter((file) => !legal.includes(file))
      .filter((file) => READS_A_BODY.test(readFileSync(file, "utf8")));
    expect(readsRequestBodies).toEqual([]);
  });

  it("bounds a web Request the same way, at the same number", async () => {
    // The Convex router gets a web `Request`, not a `node:http` stream, so it
    // has its own reader — but not its own cap: this is the identical constant
    // the Node reader imports. A body arriving as a stream carries no
    // content-length to check, which is the case that matters.
    const streamed = (bytes: number) =>
      new Request("http://convex.test/live/rooms", {
        method: "POST",
        body: new ReadableStream<Uint8Array>({
          start(c) {
            c.enqueue(new Uint8Array(bytes));
            c.close();
          },
        }),
        // @ts-expect-error — required by undici for a stream body, not in the DOM lib
        duplex: "half",
      });

    await expect(readJsonRequest(streamed(MAX_BODY_BYTES + 1))).rejects.toThrow(/body too large/);
    await expect(readBoundedBody(streamed(MAX_BODY_BYTES))).resolves.toHaveLength(MAX_BODY_BYTES);
    expect(MAX_BODY_BYTES).toBe(20 * 1024 * 1024);
  });

  it("refuses an oversized body on its declared length, before reading it", async () => {
    // A caller that announces a gigabyte is refused without that gigabyte ever
    // being read. The claim is not TRUSTED — the streamed size above is what
    // actually decides — it is only allowed to make the refusal cheap.
    const req = new Request("http://convex.test/compare/demo", {
      method: "POST",
      headers: { "content-length": String(MAX_BODY_BYTES + 1), "content-type": "application/json" },
      body: "{}",
    });
    await expect(readJsonRequest(req)).rejects.toThrow(/body too large/);
  });

  it("hands the Convex router the same validators and the same cap, not copies", () => {
    // `convex/http.ts` used to carry its own `clampTarget` (2..300) and
    // `clampTurns` (3..320): the same numbers written a second time, which is
    // how they drift. It now imports these, and identical function objects
    // cannot disagree.
    expect(convexShared.MAX_BODY_BYTES).toBe(MAX_BODY_BYTES);
    expect(convexShared.readJsonRequest).toBe(readJsonRequest);
    expect(convexShared.readBoundedBody).toBe(readBoundedBody);
    expect(convexShared.validTurns).toBe(validTurns);
    expect(convexShared.validCountTarget).toBe(validCountTarget);
    expect(convexShared.MAX_RUN_TURNS).toBe(MAX_RUN_TURNS);
    expect(convexShared.MAX_COUNT_TARGET).toBe(MAX_COUNT_TARGET);

    // …and the router takes them from that seam rather than restating them.
    const httpTs = readFileSync(fileURLToPath(new URL("../convex/http.ts", import.meta.url)), "utf8");
    expect(httpTs).toMatch(/from "\.\/shared"/);
    expect(httpTs).not.toMatch(/1024 \* 1024|\b320\b|\b300\b/);
  });

  it("still reads an ordinary web Request, and an empty one", async () => {
    const post = (body?: string) => new Request("http://convex.test/compare/demo", { method: "POST", body });
    await expect(readJsonRequest<{ target: number }>(post(JSON.stringify({ target: 12 })))).resolves.toEqual({
      target: 12,
    });
    await expect(readJsonRequest(post())).resolves.toEqual({}); // no body — same as the Node reader
  });
});

describe("P2 — target is narrowed before it can reach the reducer", () => {
  it("never lets a non-number become task.target", () => {
    const task = createVoiceRoom("abc" as unknown as number).task;
    if (task.kind !== "count_to_n") throw new Error("createVoiceRoom must build a counting room");
    expect(task.target).toBe(100);
    expect(typeof task.target).toBe("number");
    expect(validCountTarget("abc", 12)).toBe(12);
    expect(validCountTarget(1e9, 12)).toBe(MAX_COUNT_TARGET);
    expect(validCountTarget(-4, 12)).toBe(1);
    expect(validCountTarget(12, 100)).toBe(12); // ordinary requests are untouched
  });

  it("lets a room whose target arrived as a string still complete", async () => {
    const result = await runSideBySideComparison({
      target: "abc" as unknown as number,
      turns: 20,
      source: "deterministic",
    });
    const task = result.goodFinalState.task;
    expect(task.kind).toBe("count_to_n");
    expect(typeof (task as { target: number }).target).toBe("number");
    expect((task as { target: number }).target).toBe(12);
    expect(task.completed).toBe(true);
  });
});

describe("P3 — provenance reports what produced the text, not what was requested", () => {
  it("says deterministic fallback when the provider dies before the good side runs", async () => {
    vi.stubEnv("OPENAI_API_KEY", "test-key");
    vi.stubEnv("OPENAI_MODEL", "");
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const turns = 3;
    let calls = 0;
    vi.stubGlobal("fetch", async () => {
      calls += 1;
      if (calls <= turns) return okResponse("Yeah exactly, let's do that!"); // bad side answers
      throw new Error("simulated provider outage mid-run");
    });

    const result = await runSideBySideComparison({ target: 3, turns, source: "openai" });

    expect(result.provenance.fallbackTurns).toBe(result.good.length);
    expect(result.provenance.mode).toBe("deterministic");
    expect(result.provenance.modelId).toBeNull();
    expect(result.provenance.good).toContain("deterministic fallback");
    expect(result.provenance.good).not.toContain("openai · gpt-5.4-mini · live · real reducer");
    // the fallback itself is preserved: the room still counts
    expect(result.good.map((s) => s.current)).toEqual([1, 2, 3]);
    // the bad side genuinely was model-produced, and still says so
    expect(result.provenance.bad).toContain("openai · gpt-5.4-mini · live");
  });

  it("discloses a partial fallback rather than rounding it to 'live'", async () => {
    vi.stubEnv("OPENAI_API_KEY", "test-key");
    vi.stubEnv("OPENAI_MODEL", "");
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const turns = 3;
    let calls = 0;
    vi.stubGlobal("fetch", async (_url: string | URL, init?: RequestInit) => {
      calls += 1;
      if (calls === turns + 2) throw new Error("one bad turn"); // good side, 2nd turn only
      const user = (JSON.parse(String(init?.body)) as { messages: { role: string; content: string }[] }).messages.find(
        (m) => m.role === "user",
      )?.content;
      const required = user?.match(/next number: (\d+)\./)?.[1];
      return okResponse(required ?? "Yeah exactly, let's do that!");
    });

    const result = await runSideBySideComparison({ target: 3, turns, source: "openai" });

    expect(result.provenance.fallbackTurns).toBe(1);
    expect(result.provenance.mode).toBe("openai");
    expect(result.provenance.good).toContain("partial — 1 of 3 turns fell back");
  });

  it("leaves an all-model run's provenance exactly as it was", async () => {
    const result = await runSideBySideComparison({ target: 6, turns: 6, source: "deterministic" });
    expect(result.provenance.mode).toBe("deterministic");
    expect(result.provenance.fallbackTurns).toBe(0);
    expect(result.provenance.good).toContain("real reducer & scheduler");
  });
});

describe("P4 — a provider error is recorded, not swallowed", () => {
  it("reports the fallback to its caller and logs it, and still answers", async () => {
    vi.stubEnv("OPENAI_API_KEY", "");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const errors: unknown[] = [];

    const state = await runVoiceStep(createVoiceRoom(5), {
      actorId: "voice-a",
      label: "voice-a",
      source: "openai",
      onProviderError: (error) => errors.push(error),
    });

    expect(errors).toHaveLength(1);
    expect(String(errors[0])).toMatch(/OPENAI_API_KEY/);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]?.[0])).toMatch(/deterministic fallback used/);
    // the fallback is kept — the room still advances, it just is not called a model result
    expect(state.utterances.at(-1)?.text).toBe("One");
    expect(state.task.kind === "count_to_n" && state.task.current).toBe(1);
  });

  it("says nothing when the deterministic source is what was asked for", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const errors: unknown[] = [];
    await runVoiceStep(createVoiceRoom(5), {
      actorId: "voice-a",
      label: "voice-a",
      source: "deterministic",
      onProviderError: (error) => errors.push(error),
    });
    expect(errors).toHaveLength(0);
    expect(warn).not.toHaveBeenCalled();
  });
});
