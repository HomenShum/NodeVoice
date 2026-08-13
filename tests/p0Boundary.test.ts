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
 */
import { Readable } from "node:stream";
import type { IncomingMessage } from "node:http";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MAX_RUN_TURNS, validTurns } from "../src/core/agents.js";
import { MAX_COUNT_TARGET, validCountTarget } from "../src/core/steering.js";
import { createVoiceRoom } from "../src/core/roomReducer.js";
import { runSideBySideComparison } from "../src/compare/badGoodDemo.js";
import { runVoiceStep } from "../src/voice/voiceAgent.js";
import { readJson } from "../src/live/roomServer.js";

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
