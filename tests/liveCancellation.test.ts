/** A room host pauses thinking, then continues with a manual turn. No provider is contacted. */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { setTimeout as delay } from "node:timers/promises";

function gate() {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => { release = resolve; });
  return { promise, release };
}

type Job = {
  id: string;
  options: { holdLlm?: boolean; holdSpeech?: boolean; llmFailure?: boolean; speechFailure?: boolean };
  text: string;
  llmStarted: ReturnType<typeof gate>;
  llmRelease: ReturnType<typeof gate>;
  speechStarted: ReturnType<typeof gate>;
  speechRelease: ReturnType<typeof gate>;
  speechCalls: number;
};
const jobs: { id: string; queue: Job[] }[] = [];
const allJobs: Job[] = [];
const events: string[] = [];
const realFetch = globalThis.fetch;
let server: Server;
let base = "";
let providerCalls = 0;

function enqueue(id: string, options: Job["options"] = {}): Job {
  const job = {
    id, options, text: `Offline fixture answer ${allJobs.length + 1}.`,
    llmStarted: gate(), llmRelease: gate(), speechStarted: gate(), speechRelease: gate(), speechCalls: 0,
  };
  allJobs.push(job);
  const room = jobs.find((r) => r.id === id);
  if (!room) throw new Error(`Unknown fixture room ${id}`);
  room.queue.push(job);
  if (!options.holdLlm) job.llmRelease.release();
  if (!options.holdSpeech) job.speechRelease.release();
  return job;
}

async function request(path: string, body?: unknown) {
  const response = await realFetch(base + path, {
    method: body === undefined ? "GET" : "POST",
    ...(body === undefined ? {} : { headers: { "content-type": "application/json" }, body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(5_000),
  });
  return { status: response.status, body: await response.json() as any };
}

async function room() {
  const goal = `Offline pause fixture ${jobs.length + 1}`;
  const created = await request("/live/rooms", { goal });
  expect(created.status).toBe(200);
  const id = created.body.roomId as string;
  jobs.push({ id, queue: [] });
  return { id, goal };
}

async function pause(id: string) {
  const paused = await request(`/live/rooms/${id}/run`, { running: false });
  expect(paused.status).toBe(200);
  expect(paused.body.room.state.running).toBe(false);
  events.push(`${id}:pause-acknowledged`);
}

async function start(id: string) {
  const started = await request(`/live/rooms/${id}/run`, { running: true });
  expect(started.status).toBe(200);
  expect(started.body.room.state.running).toBe(true);
}

async function recover(id: string, canceled: Job, priorTurn: number) {
  const control = enqueue(id);
  // Only the real HTTP busy response permits a retry. Admission proves the old turn ended.
  for (let attempt = 0; attempt < 250; attempt++) {
    const result = await request(`/live/rooms/${id}/step`, {});
    if (result.status === 409 && result.body.error === "room is busy") {
      await delay(20);
      continue;
    }
    expect(result.status).toBe(200);
    expect(result.body.room.state).toMatchObject({ turn: priorTurn + 1, running: false });
    const utterances = result.body.room.utterances as { text: string; audioId?: string }[];
    expect(utterances.some((u) => u.text === canceled.text)).toBe(false);
    const spoken = utterances.find((u) => u.text === control.text);
    expect(spoken?.audioId).toBeTruthy();
    expect(control.speechCalls).toBe(1);
    const audio = await realFetch(`${base}/live/audio/${spoken!.audioId}`, { signal: AbortSignal.timeout(5_000) });
    expect(audio.status).toBe(200);
    expect([...new Uint8Array(await audio.arrayBuffer())]).toEqual([1, 2, 3]);
    events.push(`${id}:manual-recovery:${priorTurn + 1}`);
    return;
  }
  throw new Error("Canceled turn did not release the room within the bounded retry budget");
}

beforeAll(async () => {
  vi.stubEnv("OPENAI_API_KEY", "offline-fixture-not-a-secret");
  vi.stubEnv("TTS_PROVIDER", "openai");
  // Install before importing the real pipeline. Unknown destinations fail closed.
  vi.stubGlobal("fetch", async (input: string | URL | Request, init?: RequestInit) => {
    if (++providerCalls > 256) throw new Error("Fixture provider request budget exceeded");
    const url = input instanceof Request ? input.url : String(input);
    const body = JSON.parse(String(init?.body));
    if (url === "https://api.openai.com/v1/chat/completions") {
      const goal = String(body.messages?.[0]?.content).match(/Shared goal: (Offline pause fixture \d+)/)?.[1];
      const index = goal ? Number(goal.split(" ").at(-1)) - 1 : -1;
      const job = jobs[index]?.queue.shift();
      if (!job) throw new Error(`Unplanned LLM request for ${goal}`);
      events.push(`${job.id}:llm-start:${job.text}`);
      job.llmStarted.release();
      await job.llmRelease.promise;
      events.push(`${job.id}:llm-release:${job.text}`);
      if (job.options.llmFailure) return new Response("synthetic unavailable", { status: 503 });
      return Response.json({ choices: [{ message: { content: JSON.stringify({ text: job.text, speechAct: "task_action", done: false }) } }] });
    }
    if (url === "https://api.openai.com/v1/audio/speech") {
      const job = allJobs.find((candidate) => candidate.text === body.input);
      if (!job) throw new Error("Unplanned speech request");
      job.speechCalls++;
      events.push(`${job.id}:speech-start:${job.text}`);
      job.speechStarted.release();
      await job.speechRelease.promise;
      return job.options.speechFailure
        ? new Response("synthetic unavailable", { status: 503 })
        : new Response(Uint8Array.from([1, 2, 3]), { headers: { "content-type": "audio/mpeg" } });
    }
    throw new Error(`External destination forbidden in offline fixture: ${url}`);
  });
  const { handleLive } = await import("../src/live/roomServer.js");
  server = createServer((req, res) => {
    void handleLive(req, res, new URL(req.url ?? "/", "http://localhost").pathname)
      .then((handled) => { if (!handled) res.writeHead(404).end(); })
      .catch((error) => { res.writeHead(500).end(String(error)); });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  console.log("PAUSE_PROOF", JSON.stringify({ providerCalls, externalNetworkCalls: 0, jobs: allJobs.map(({ text, speechCalls, options }) => ({ text, speechCalls, options })), events }));
  let quiescent = false;
  try {
    try {
      for (const item of jobs) await pause(item.id);
    } finally {
      for (const job of allJobs) { job.llmRelease.release(); job.speechRelease.release(); }
    }
    for (const item of jobs) {
      item.queue.length = 0; // Discard only fixture jobs that never started.
      enqueue(item.id);
      let settled = false;
      for (let attempt = 0; attempt < 250; attempt++) {
        const result = await request(`/live/rooms/${item.id}/step`, {});
        if (result.status === 409 && result.body.error === "room is busy") {
          await delay(20);
          continue;
        }
        expect(result.status).toBe(200);
        settled = true;
        break;
      }
      expect(settled).toBe(true);
    }
    quiescent = true;
  } finally {
    if (server?.listening) {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
    // A failed teardown must keep provider access intercepted until the worker exits.
    if (quiescent) {
      vi.unstubAllGlobals();
      vi.unstubAllEnvs();
    }
  }
}, 30_000);

describe("a local room host pauses obsolete work and can continue", () => {
  it("does not start speech after four simultaneous pending generations are paused", async () => {
    const pending: { id: string; job: Job }[] = [];
    for (let i = 0; i < 4; i++) {
      const { id } = await room();
      const job = enqueue(id, { holdLlm: true });
      await start(id);
      await job.llmStarted.promise;
      await pause(id);
      pending.push({ id, job });
    }
    for (const { job } of pending) job.llmRelease.release();
    await Promise.all(pending.map(({ id, job }) => recover(id, job, 0)));
    for (const { job } of pending) expect.soft(job.speechCalls).toBe(0);
  }, 15_000);

  it("preserves cancellation and recovery through sixteen turns in one room", async () => {
    const { id } = await room();
    for (let cycle = 0; cycle < 16; cycle++) {
      const job = enqueue(id, { holdLlm: true });
      await start(id);
      await job.llmStarted.promise;
      await pause(id);
      job.llmRelease.release();
      await recover(id, job, cycle);
      expect.soft(job.speechCalls).toBe(0);
    }
  }, 15_000);

  it("still discards output when pause arrives during speech already in flight", async () => {
    const { id } = await room();
    const job = enqueue(id, { holdSpeech: true });
    await start(id);
    await job.speechStarted.promise;
    await pause(id);
    job.speechRelease.release();
    await recover(id, job, 0);
    expect(job.speechCalls).toBe(1);
  });

  it("recovers from canceled generation failure and keeps speech best-effort for manual work", async () => {
    const { id } = await room();
    const canceled = enqueue(id, { holdLlm: true, llmFailure: true });
    await start(id);
    await canceled.llmStarted.promise;
    await pause(id);
    canceled.llmRelease.release();
    await recover(id, canceled, 0);
    expect(canceled.speechCalls).toBe(0);
    const degraded = enqueue(id, { speechFailure: true });
    const result = await request(`/live/rooms/${id}/step`, {});
    expect(result.status).toBe(200);
    expect(result.body.room.state.turn).toBe(2);
    expect(result.body.room.utterances.at(-1)).toMatchObject({ text: degraded.text });
    expect(result.body.room.utterances.at(-1).audioId).toBeUndefined();
    expect(degraded.speechCalls).toBe(2); // Existing primary and fallback both fail.
  });
});
