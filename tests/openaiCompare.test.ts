import { afterEach, describe, expect, it, vi } from "vitest";
import { buildBadAgentPrompt, runSideBySideComparison, type BadAgentPrivateState } from "../src/compare/badGoodDemo.js";
import { openaiChat } from "../src/providers/openai.js";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

function okResponse(content: string): Response {
  return new Response(JSON.stringify({ choices: [{ message: { content } }] }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

function sampleState(): BadAgentPrivateState {
  return {
    agentId: "voice-b",
    heardCount: 2,
    spokeCount: 1,
    believesCurrent: 1,
    lastClassifiedAs: "backchannel",
    nextIntent: "acknowledge",
  };
}

describe("openai compare source", () => {
  it("shapes chat-completion requests for the repo default model with the key in the header only", async () => {
    vi.stubEnv("OPENAI_API_KEY", "test-key");
    vi.stubEnv("OPENAI_MODEL", "");
    const calls: { url: string; init: RequestInit }[] = [];
    vi.stubGlobal("fetch", async (url: string | URL, init?: RequestInit) => {
      calls.push({ url: String(url), init: init ?? {} });
      return okResponse("  Two  ");
    });

    const text = await openaiChat([
      { role: "system", content: "Return only the requested spoken utterance, with no markdown." },
      { role: "user", content: "Say the next number: 2." },
    ]);

    expect(text).toBe("Two"); // response content is trimmed
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe("https://api.openai.com/v1/chat/completions");
    const headers = calls[0]?.init.headers as Record<string, string>;
    expect(headers.authorization).toBe("Bearer test-key");
    const body = JSON.parse(String(calls[0]?.init.body)) as Record<string, unknown>;
    expect(body.model).toBe("gpt-5.4-mini");
    // gpt-5.x reasoning-model param shape (same as src/live/pipeline.ts)
    expect(body.max_completion_tokens).toBe(600);
    expect(body.reasoning_effort).toBeDefined();
    expect(body.temperature).toBeUndefined();
    // the key must never appear in the request body / stream payloads
    expect(String(calls[0]?.init.body)).not.toContain("test-key");
  });

  it("fails clearly when the key is absent, without crashing the keyless CI path", async () => {
    vi.stubEnv("OPENAI_API_KEY", "");
    await expect(openaiChat([{ role: "user", content: "hi" }])).rejects.toThrow(/OPENAI_API_KEY/);
    await expect(runSideBySideComparison({ target: 4, turns: 4, source: "openai" })).rejects.toThrow(
      /OPENAI_API_KEY/,
    );
  });

  it("surfaces non-ok provider responses as errors", async () => {
    vi.stubEnv("OPENAI_API_KEY", "test-key");
    vi.stubGlobal("fetch", async () => new Response("boom", { status: 500 }));
    await expect(openaiChat([{ role: "user", content: "hi" }])).rejects.toThrow(/OpenAI HTTP 500/);
  });

  it("bad-side prompts carry only raw transcript + private notes — never room state", () => {
    const messages = buildBadAgentPrompt(sampleState(), [{ actorId: "voice-a", text: "One..." }], 12);
    const system = messages[0]?.content ?? "";
    const user = messages[1]?.content ?? "";
    expect(system).toContain("no shared task state, no floor control, and no turn scheduler");
    expect(user).toContain("voice-a: One...");
    expect(user).toContain("Your private notes");
    expect(user).toContain("you believe the count is currently at 1");
    for (const forbidden of ["nextRequiredAct", "floorOwner", "authoritative", "roomState"]) {
      expect(system).not.toContain(forbidden);
      expect(user).not.toContain(forbidden);
    }
  });

  it("openai mode drives BOTH sides with real model text and keeps the private-state panel truthful", async () => {
    vi.stubEnv("OPENAI_API_KEY", "test-key");
    vi.stubEnv("OPENAI_MODEL", "");
    const bodies: string[] = [];
    vi.stubGlobal("fetch", async (_url: string | URL, init?: RequestInit) => {
      const body = String(init?.body);
      bodies.push(body);
      const parsed = JSON.parse(body) as { messages: { role: string; content: string }[] };
      const userMessage = parsed.messages.find((m) => m.role === "user")?.content ?? "";
      if (userMessage.includes("authoritative")) {
        // good side: room-constrained prompt names the required number
        const match = userMessage.match(/next number: (\d+)\./);
        return okResponse(match?.[1] ?? "1");
      }
      // bad side: a naive transcript-reacting agent politely agrees
      return okResponse("Yeah exactly, let's do that!");
    });

    const result = await runSideBySideComparison({ target: 3, turns: 3, source: "openai" });

    expect(result.provenance.mode).toBe("openai");
    expect(result.provenance.modelId).toBe("gpt-5.4-mini");
    expect(result.provenance.bad).toContain("openai · gpt-5.4-mini · live");
    expect(result.provenance.good).toContain("openai · gpt-5.4-mini · live");

    // bad side carries the real model text, truthfully classified
    for (const step of result.bad) {
      expect(step.text).toBe("Yeah exactly, let's do that!");
      expect(step.speechAct).toBe("backchannel");
      expect(step.agentStates).toHaveLength(3);
    }
    const lastStates = result.bad.at(-1)?.agentStates ?? [];
    // no number was ever spoken, so private beliefs honestly stay at 0
    expect(lastStates.map((s) => s.believesCurrent)).toEqual([0, 0, 0]);
    expect(lastStates.every((s) => s.nextIntent === "acknowledge" || s.nextIntent === "wait-for-someone")).toBe(true);

    // good side counts to target under the reducer with model-produced numbers
    expect(result.good.map((step) => step.current)).toEqual([1, 2, 3]);
    expect(result.goodFinalState.task.completed).toBe(true);

    // the key never leaks into any request body
    expect(bodies.every((body) => !body.includes("test-key"))).toBe(true);
  });
});
