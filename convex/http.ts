import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { BODY_TOO_LARGE, readBoundedBody, readJsonRequest, validCountTarget, validTurns } from "./shared";

/**
 * HTTP bridge: mirrors the Node server's /live/* API so the existing frontend
 * works against Convex by only changing its base URL. There is no /events (SSE)
 * route — the client's polling fallback (GET /live/rooms/:id) takes over, which
 * is what we want anyway (Convex + Vercel = permanent URL, laptop can sleep).
 *
 * These are the SAME public routes as `src/server.ts` and
 * `src/live/roomServer.ts`, so they get the same bounds. This file reads a
 * request body in exactly two places — `body()` and `binaryBody()` below — and
 * both go through `src/core/requestBody.ts`, which holds the one 20 MB cap the
 * Node reader also imports. It narrows with the same `validTurns` /
 * `validCountTarget` the Node routes use, rather than a second copy of the
 * numbers. `tests/p0Boundary.test.ts` walks `src/` and `convex/` to check that
 * no third reader appears.
 */
const CORS: Record<string, string> = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, POST, OPTIONS",
  "access-control-allow-headers": "content-type",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...CORS } });
const preflight = httpAction(async () => new Response(null, { status: 204, headers: CORS }));

/**
 * Every POST handler in this file reads its body here. A `Response` coming back
 * instead of a body IS the answer — return it. The refusal is a status, not a
 * silently-empty object: a 20 MB+ upload used to be parsed into `{}` and the
 * route carried on as if the caller had sent nothing.
 */
async function body<T>(req: Request): Promise<T | Response> {
  try {
    return await readJsonRequest<T>(req);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return message === BODY_TOO_LARGE
      ? json({ ok: false, error: BODY_TOO_LARGE }, 413)
      : json({ ok: false, error: message.slice(0, 200) }, 400);
  }
}

/** The same cap for the one route that takes bytes rather than JSON (audio). */
async function binaryBody(req: Request): Promise<Uint8Array | Response> {
  try {
    return await readBoundedBody(req);
  } catch {
    return json({ ok: false, error: BODY_TOO_LARGE }, 413);
  }
}

const DEMO_VOICE_MODELS = [
  {
    id: "prod_deterministic_voice",
    label: "Production deterministic demo",
    bucket: "practical_stable",
    ollamaModel: "deterministic-sim",
    parameterSize: "0B",
    hardwareTier: "hosted",
    availability: "production",
    recommendedFor: ["voice"],
    pull: "built in",
    notes: "Hosted side-by-side demo path. Local Node can still use Ollama/OpenAI sources.",
  },
];

const DEMO_NODE_MODELS = [
  {
    id: "prod_deterministic_node",
    label: "Production deterministic NodeAgent stub",
    bucket: "practical_stable",
    ollamaModel: "deterministic-node",
    parameterSize: "0B",
    hardwareTier: "hosted",
    availability: "production",
    recommendedFor: ["nodeagent"],
    pull: "built in",
    notes: "Hosted demo model list placeholder. Run local Node for the full artifact chain.",
  },
];

const modelsGet = httpAction(async () =>
  json({
    ok: true,
    refreshedAt: "2026-07-05",
    defaults: { voice: "prod_deterministic_voice", nodeagent: "prod_deterministic_node" },
    all: [...DEMO_VOICE_MODELS, ...DEMO_NODE_MODELS],
    cloudOnlyReference: [],
    voice: DEMO_VOICE_MODELS,
    nodeagent: DEMO_NODE_MODELS,
    code: [],
    vision: [],
    embedding: [],
  }),
);

type DemoAgentState = {
  agentId: string;
  heardCount: number;
  spokeCount: number;
  believesCurrent: number;
  lastClassifiedAs: string;
  nextIntent: string;
};

function numberWord(n: number): string {
  const small = ["Zero", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten"];
  if (n >= 0 && n < small.length) return small[n]!;
  return String(n);
}

function demoStateSummary(current: number, target: number, scheduled: string): string {
  const next = Math.min(current + 1, target);
  return `current=${current} next=${next} target=${target} scheduled=${scheduled}`;
}

function runHostedComparison(body: { target?: number; turns?: number; source?: string }) {
  // The same two narrowings the Node routes use — `validCountTarget` bounds by
  // MAX_COUNT_TARGET and `validTurns` by MAX_RUN_TURNS. Only the hosted demo's
  // DEFAULTS are local (100 / the target); the caps are not restated here,
  // because a cap written down twice drifts.
  const target = validCountTarget(body.target);
  const turns = validTurns(body.turns, Math.min(target, 100));
  const agents = ["voice-a", "voice-b", "voice-c"];
  const ack = [
    "Yeah exactly, let's do that. I'll start off from where you leave off...",
    "Yep exactly, let's do that, we can continue from there...",
    "Sounds good, I'm aligned, and I'll start after you finish...",
  ];
  const states = new Map<string, DemoAgentState>(
    agents.map((agentId) => [
      agentId,
      { agentId, heardCount: 0, spokeCount: 0, believesCurrent: 0, lastClassifiedAs: "none", nextIntent: agentId === "voice-a" ? "start-counting" : "wait-for-someone" },
    ]),
  );
  const bad = [];
  for (let i = 0; i < turns; i += 1) {
    const actorId = agents[i % agents.length]!;
    const state = states.get(actorId)!;
    const starts = state.nextIntent === "start-counting";
    const text = starts ? `I'll count from 1 to ${target}, and you guys can continue off where I started from. One...` : ack[i % ack.length]!;
    const speechAct = starts ? "instruction" : "backchannel";
    states.set(actorId, { ...state, spokeCount: state.spokeCount + 1, believesCurrent: starts ? 1 : state.believesCurrent, nextIntent: "wait-for-someone" });
    for (const id of agents) {
      if (id === actorId) continue;
      const s = states.get(id)!;
      states.set(id, {
        ...s,
        heardCount: s.heardCount + 1,
        believesCurrent: starts ? Math.max(s.believesCurrent, 1) : s.believesCurrent,
        lastClassifiedAs: speechAct,
        nextIntent: "acknowledge",
      });
    }
    bad.push({
      turn: i + 1,
      actorId,
      text,
      speechAct,
      loopRisk: i >= 1,
      roomStateSummary: `no shared room; private beliefs current=${[...states.values()].map((s) => s.believesCurrent).join("/")}; classified=${speechAct}`,
      agentStates: [...states.values()],
    });
  }

  const good = [];
  const goodTurns = Math.min(turns, target);
  for (let i = 0; i < goodTurns; i += 1) {
    const current = i + 1;
    const actorId = agents[i % agents.length]!;
    const nextSpeaker = agents[(i + 1) % agents.length]!;
    good.push({
      turn: current,
      actorId,
      text: numberWord(current),
      speechAct: "task_action",
      current,
      next: Math.min(current + 1, target),
      loopRisk: false,
      roomStateSummary: demoStateSummary(current, target, nextSpeaker),
    });
  }

  return {
    bad,
    good,
    goodFinalState: {
      task: { kind: "count_to_n", target, current: goodTurns, next: Math.min(goodTurns + 1, target), completed: goodTurns >= target },
      mode: goodTurns >= target ? "review" : "execution",
      floorOwner: goodTurns >= target ? null : agents[goodTurns % agents.length],
      nextSpeaker: goodTurns >= target ? null : agents[goodTurns % agents.length],
      suppressAcknowledgements: true,
      loopRisk: false,
      utterances: [],
      artifacts: [],
      version: goodTurns,
    },
    selectedModel: body.source === "openai" ? "hosted deterministic fallback" : "deterministic-sim",
    provenance: {
      mode: "deterministic",
      modelId: null,
      bad: "production deterministic sim - raw transcripts only, no reducer, no scheduler",
      good: "production deterministic sim - real reducer & scheduler",
    },
    diagnosis: [
      "Bad: every agent treats every heard utterance as a fresh invitation to respond socially.",
      "Bad: each agent has only a private belief and no shared truth.",
      "Good: the room reducer commits task actions and schedules exactly one next speaker.",
      "Good: each agent receives authoritative next state, not raw transcript politeness pressure.",
    ],
  };
}

const compareDemo = httpAction(async (_ctx, req) => {
  const parsed = await body<{ target?: number; turns?: number; source?: string }>(req);
  if (parsed instanceof Response) return parsed;
  return json(runHostedComparison(parsed));
});

const nodeAgentRun = httpAction(async () =>
  json(
    {
      ok: false,
      error: "The hosted /demo supports side-by-side comparison. Run the local Node server for the full NodeAgent artifact chain.",
    },
    501,
  ),
);

const create = httpAction(async (ctx, req) => {
  const parsed = await body<{ goal?: string; model?: string; private?: boolean; profile?: string; agentCount?: number }>(req);
  if (parsed instanceof Response) return parsed;
  // goal/model/profile/agentCount are narrowed by `api.rooms.createRoom`
  // (validProfile / validModel / validAgentCount) — the seam every caller of
  // the room, HTTP or Convex client, already shares.
  const roomId = await ctx.runMutation(api.rooms.createRoom, {
    goal: parsed.goal,
    model: parsed.model,
    private: parsed.private === true,
    profile: parsed.profile,
    agentCount: parsed.agentCount,
  });
  const room = await ctx.runQuery(api.rooms.watchRoom, { roomId });
  return json({ ok: true, roomId, room });
});

const roomsGet = httpAction(async (ctx, req) => {
  const parts = new URL(req.url).pathname.split("/").filter(Boolean); // [live, rooms, id, sub?]
  const id = parts[2] as Id<"rooms"> | undefined;
  const sub = parts[3];
  if (!id) return json({ ok: false, error: "bad room id" }, 400);
  if (sub === "events") return new Response("SSE not supported — poll /live/rooms/:id", { status: 404, headers: CORS });
  try {
    const room = await ctx.runQuery(api.rooms.watchRoom, { roomId: id });
    if (!room) return json({ ok: false, error: "room not found" }, 404);
    return json({ ok: true, room });
  } catch {
    return json({ ok: false, error: "room not found" }, 404);
  }
});

const roomsPost = httpAction(async (ctx, req) => {
  const parts = new URL(req.url).pathname.split("/").filter(Boolean);
  const id = parts[2] as Id<"rooms"> | undefined;
  const sub = parts[3];
  if (!id) return json({ ok: false, error: "bad room id" }, 400);
  try {
    if (sub === "join") {
      const b = await body<{ slot?: string; kind?: string }>(req);
      if (b instanceof Response) return b;
      const joined = await ctx.runMutation(api.rooms.joinRoom, { roomId: id, slot: b.slot, kind: b.kind });
      const joinedRoom = await ctx.runQuery(api.rooms.watchRoom, { roomId: id });
      return json({ ok: true, participantId: joined.participantId, slot: joined.slot, room: joinedRoom });
    }
    if (sub === "goal") {
      const b = await body<{ goal?: string }>(req);
      if (b instanceof Response) return b;
      if (b.goal) await ctx.runMutation(api.rooms.setGoal, { roomId: id, goal: b.goal });
      return json({ ok: true, room: await ctx.runQuery(api.rooms.watchRoom, { roomId: id }) });
    }
    if (sub === "model") {
      const b = await body<{ model?: string }>(req);
      if (b instanceof Response) return b;
      await ctx.runMutation(api.rooms.setModel, { roomId: id, model: b.model ?? "" });
      return json({ ok: true, room: await ctx.runQuery(api.rooms.watchRoom, { roomId: id }) });
    }
    if (sub === "profile") {
      const b = await body<{ profile?: string }>(req);
      if (b instanceof Response) return b;
      await ctx.runMutation(api.rooms.setProfile, { roomId: id, profile: b.profile ?? "" });
      return json({ ok: true, room: await ctx.runQuery(api.rooms.watchRoom, { roomId: id }) });
    }
    if (sub === "agents") {
      const b = await body<{ agentCount?: number; delta?: number }>(req);
      if (b instanceof Response) return b;
      const room = await ctx.runQuery(api.rooms.watchRoom, { roomId: id });
      const current = room?.state?.agentCount ?? 2;
      const agentCount = typeof b.agentCount === "number" ? b.agentCount : current + (typeof b.delta === "number" ? b.delta : 1);
      await ctx.runMutation(api.rooms.setAgentCount, { roomId: id, agentCount });
      return json({ ok: true, room: await ctx.runQuery(api.rooms.watchRoom, { roomId: id }) });
    }
    if (sub === "run") {
      const b = await body<{ running?: boolean }>(req);
      if (b instanceof Response) return b;
      await ctx.runMutation(api.rooms.setRunning, { roomId: id, running: Boolean(b.running) });
      return json({ ok: true, room: await ctx.runQuery(api.rooms.watchRoom, { roomId: id }) });
    }
    if (sub === "step") {
      const stepped = await ctx.runAction(api.coordinator.stepOnce, { roomId: id });
      if (!stepped?.ok) return json({ ok: false, error: stepped?.reason ?? "room is busy" }, 409);
      return json({ ok: true, room: await ctx.runQuery(api.rooms.watchRoom, { roomId: id }) });
    }
    if (sub === "human") {
      const ct = req.headers.get("content-type") ?? "";
      if (ct.includes("application/json")) {
        const b = await body<{ text?: string }>(req);
        if (b instanceof Response) return b;
        if (b.text) await ctx.runMutation(api.rooms.submitHuman, { roomId: id, text: b.text });
        return json({ ok: true });
      }
      const bytes = await binaryBody(req);
      if (bytes instanceof Response) return bytes;
      let bin = "";
      for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]!);
      const audioBase64 = btoa(bin);
      const res = await ctx.runAction(api.coordinator.transcribeHuman, { roomId: id, audioBase64, mime: ct || "audio/webm" });
      return json({ ok: true, text: res.text });
    }
    return json({ ok: false, error: "unknown route" }, 404);
  } catch (e) {
    return json({ ok: false, error: String(e).slice(0, 200) }, 502);
  }
});

const audioGet = httpAction(async (ctx, req) => {
  const parts = new URL(req.url).pathname.split("/").filter(Boolean); // [live, audio, id]
  const id = parts[2] as Id<"_storage"> | undefined;
  if (!id) return new Response("bad id", { status: 400, headers: CORS });
  const blob = await ctx.storage.get(id);
  if (!blob) return new Response("not found", { status: 404, headers: CORS });
  return new Response(blob, { status: 200, headers: { "content-type": "audio/mpeg", "cache-control": "public, max-age=3600", ...CORS } });
});

const http = httpRouter();
http.route({ path: "/api/models", method: "GET", handler: modelsGet });
http.route({ path: "/api/models", method: "OPTIONS", handler: preflight });
http.route({ path: "/compare/demo", method: "POST", handler: compareDemo });
http.route({ path: "/compare/demo", method: "OPTIONS", handler: preflight });
http.route({ path: "/nodeagents/run", method: "POST", handler: nodeAgentRun });
http.route({ path: "/nodeagents/run", method: "OPTIONS", handler: preflight });
http.route({ path: "/live/rooms", method: "POST", handler: create });
http.route({ path: "/live/rooms", method: "OPTIONS", handler: preflight });
http.route({ pathPrefix: "/live/rooms/", method: "GET", handler: roomsGet });
http.route({ pathPrefix: "/live/rooms/", method: "POST", handler: roomsPost });
http.route({ pathPrefix: "/live/rooms/", method: "OPTIONS", handler: preflight });
http.route({ pathPrefix: "/live/audio/", method: "GET", handler: audioGet });
http.route({ pathPrefix: "/live/audio/", method: "OPTIONS", handler: preflight });
export default http;
