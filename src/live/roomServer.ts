/**
 * Live multi-device voice room.
 *
 * Two AI voice agents (Ada = laptop slot, Ben = phone slot) collaborate out loud
 * on a shared goal. A server-authoritative scheduler owns the floor and prevents
 * acknowledgement loops — the same thesis as the compare demo, but real:
 * separate devices, real speech (Whisper → LLM → ElevenLabs), one shared room.
 *
 * Transport is SSE (server→client) + POST (client→server): no extra deps, works
 * through a cloudflared tunnel, and works on iOS Safari.
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import { randomUUID } from "node:crypto";
import { generateAgentTurn, synthesizeSpeech, transcribeAudio, ROUTER_MODELS, DEFAULT_LLM_MODEL, type AgentVoice } from "./pipeline.js";

function validModel(m?: string): string {
  return m && ROUTER_MODELS.some((x) => x.id === m) ? m : DEFAULT_LLM_MODEL;
}

type Slot = "a" | "b";

interface AgentDef {
  slot: Slot;
  name: string;
  device: "laptop" | "phone";
  voice: AgentVoice;
  color: string;
  persona: string;
}

const AGENTS: Record<Slot, AgentDef> = {
  a: {
    slot: "a",
    name: "Ada",
    device: "laptop",
    voice: { openai: "nova", eleven: "21m00Tcm4TlvDq8ikWAM" }, // warm female / Rachel
    color: "sky",
    persona: "A decisive planner. Proposes concrete, specific options with names and rough timing, and pushes to lock decisions.",
  },
  b: {
    slot: "b",
    name: "Ben",
    device: "phone",
    voice: { openai: "onyx", eleven: "pNInz6obpgDQGcFmaJgB" }, // deep male / Adam
    color: "violet",
    persona: "A thoughtful challenger. Asks one sharp question, checks constraints and budget, then refines the plan.",
  },
};

const DEFAULT_GOAL =
  "Plan a great Saturday for two friends in San Francisco and agree on a final 3-stop itinerary with rough timing.";

interface Utterance {
  id: string;
  slot: Slot | "human" | "system";
  name: string;
  text: string;
  speechAct: string;
  ts: number;
  audioId?: string;
}

interface RoomState {
  goal: string;
  model: string;
  floorOwner: Slot;
  turn: number;
  running: boolean;
  done: boolean;
  loopRisk: boolean;
  recentActs: string[];
}

/** One entry in the proof layer — mirrors the Convex `traces` table shape. */
interface TraceEvent {
  id: string;
  kind: string;
  summary: string;
  payload?: unknown;
  ts: number;
}

interface Room {
  id: string;
  createdAt: number;
  lastActivity: number;
  state: RoomState;
  utterances: Utterance[];
  traces: TraceEvent[];
  audio: Map<string, { mime: string; buf: Buffer; ts: number }>;
  participants: Map<string, { slot: Slot | "spectator"; kind: string; lastSeen: number }>;
  sse: Set<ServerResponse>;
  pendingHuman: string | null;
  loopToken: number; // increments to cancel a stale run loop
  busy: boolean;
}

// ── bounded registries ────────────────────────────────────────────────
const ROOMS = new Map<string, Room>();
const MAX_ROOMS = 40;
const MAX_UTTERANCES = 300;
const MAX_TRACES = 60;
const MAX_AUDIO_PER_ROOM = 60;
const MAX_SSE_PER_ROOM = 30;
const MAX_RUN_TURNS = 40;
const ROOM_TTL_MS = 2 * 60 * 60 * 1000;
const MAX_BODY_BYTES = 20 * 1024 * 1024;

function evictIfNeeded() {
  const now = Date.now();
  for (const [id, room] of ROOMS) {
    if (now - room.lastActivity > ROOM_TTL_MS) {
      room.loopToken++;
      for (const res of room.sse) safeEnd(res);
      ROOMS.delete(id);
    }
  }
  while (ROOMS.size > MAX_ROOMS) {
    let oldest: string | null = null;
    let oldestT = Infinity;
    for (const [id, room] of ROOMS) {
      if (room.lastActivity < oldestT) ((oldestT = room.lastActivity), (oldest = id));
    }
    if (!oldest) break;
    const r = ROOMS.get(oldest)!;
    r.loopToken++;
    for (const res of r.sse) safeEnd(res);
    ROOMS.delete(oldest);
  }
}

function createRoom(goal: string, model?: string): Room {
  evictIfNeeded();
  const id = shortId();
  const room: Room = {
    id,
    createdAt: Date.now(),
    lastActivity: Date.now(),
    state: { goal: goal || DEFAULT_GOAL, model: validModel(model), floorOwner: "a", turn: 0, running: false, done: false, loopRisk: false, recentActs: [] },
    utterances: [],
    traces: [],
    audio: new Map(),
    participants: new Map(),
    sse: new Set(),
    pendingHuman: null,
    loopToken: 0,
    busy: false,
  };
  pushTrace(room, "state_reduced", "Room created.", { goal: room.state.goal, model: room.state.model });
  ROOMS.set(id, room);
  return room;
}

/** Append to the proof layer (bounded). Traces ride along on state broadcasts. */
function pushTrace(room: Room, kind: string, summary: string, payload?: unknown) {
  room.traces.push({ id: randomUUID().replace(/-/g, "").slice(0, 10), kind, summary, payload, ts: Date.now() });
  while (room.traces.length > MAX_TRACES) room.traces.shift();
}

function shortId(): string {
  return randomUUID().replace(/-/g, "").slice(0, 6);
}

// ── serialization for clients ─────────────────────────────────────────
function publicRoom(room: Room) {
  return {
    id: room.id,
    agents: {
      a: pickAgent(AGENTS.a),
      b: pickAgent(AGENTS.b),
    },
    state: {
      goal: room.state.goal,
      model: room.state.model,
      floorOwner: room.state.floorOwner,
      nextSpeaker: room.state.floorOwner,
      turn: room.state.turn,
      running: room.state.running,
      done: room.state.done,
      loopRisk: room.state.loopRisk,
      nextRequiredAct: "task_action",
      suppressAcknowledgements: true,
    },
    models: ROUTER_MODELS,
    participants: [...room.participants.values()].map((p) => ({ slot: p.slot, kind: p.kind })),
    utterances: room.utterances,
    traces: room.traces.slice(-40),
  };
}
function pickAgent(a: AgentDef) {
  return { slot: a.slot, name: a.name, device: a.device, color: a.color, persona: a.persona };
}

// ── SSE plumbing ──────────────────────────────────────────────────────
function safeEnd(res: ServerResponse) {
  try {
    res.end();
  } catch {
    /* ignore */
  }
}
function sseSend(res: ServerResponse, event: unknown) {
  try {
    res.write(`data: ${JSON.stringify(event)}\n\n`);
  } catch {
    /* ignore */
  }
}
function broadcast(room: Room, event: unknown) {
  for (const res of room.sse) sseSend(res, event);
}
function broadcastState(room: Room) {
  broadcast(room, { type: "state", room: publicRoom(room) });
}

function pushUtterance(room: Room, u: Utterance) {
  room.utterances.push(u);
  while (room.utterances.length > MAX_UTTERANCES) room.utterances.shift();
  room.lastActivity = Date.now();
  broadcast(room, { type: "utterance", utterance: u });
}

function storeAudio(room: Room, mime: string, buf: Buffer): string {
  const id = randomUUID().replace(/-/g, "").slice(0, 12);
  room.audio.set(id, { mime, buf, ts: Date.now() });
  while (room.audio.size > MAX_AUDIO_PER_ROOM) {
    const firstKey = room.audio.keys().next().value as string | undefined;
    if (!firstKey) break;
    room.audio.delete(firstKey);
  }
  return id;
}

// ── one agent turn ────────────────────────────────────────────────────
async function runOneTurn(room: Room, slot: Slot): Promise<AgentTurnOutcome> {
  const agent = AGENTS[slot];
  const other = AGENTS[slot === "a" ? "b" : "a"];
  const humanNote = room.pendingHuman ?? undefined;
  room.pendingHuman = null;

  const turn = await generateAgentTurn({
    goal: room.state.goal,
    persona: agent.persona,
    selfName: agent.name,
    otherName: other.name,
    transcript: room.utterances.map((u) => ({ name: u.name, text: u.text })),
    humanNote,
    recentActs: room.state.recentActs,
    model: room.state.model,
  });

  let audioId: string | undefined;
  try {
    const audio = await synthesizeSpeech(turn.text, agent.voice);
    audioId = storeAudio(room, audio.mime, audio.buf);
  } catch (err) {
    // speech is best-effort; the transcript still advances
    console.warn(`[live] tts failed for ${agent.name}:`, String(err).slice(0, 160));
    audioId = undefined;
  }

  const u: Utterance = {
    id: randomUUID().replace(/-/g, "").slice(0, 10),
    slot,
    name: agent.name,
    text: turn.text,
    speechAct: turn.speechAct,
    ts: Date.now(),
    audioId,
  };

  // room reducer: advance floor, track loop-risk, honor completion
  room.state.turn += 1;
  room.state.recentActs = [...room.state.recentActs, turn.speechAct].slice(-4);
  room.state.loopRisk = room.state.recentActs.slice(-2).every((a) => a === "backchannel");
  room.state.floorOwner = slot === "a" ? "b" : "a";
  if (turn.done) room.state.done = true;

  if (turn.speechAct === "backchannel") {
    pushTrace(room, "guardrail_evaluated", "Backchannel — not counted as progress.", { text: turn.text });
  }
  pushTrace(room, "state_reduced", `${agent.name} took the floor turn ${room.state.turn}.`, { speechAct: turn.speechAct, done: turn.done });
  pushTrace(room, "scheduler_selected", `${AGENTS[room.state.floorOwner].name} owns the next floor.`, {
    floorOwner: room.state.floorOwner,
    loopRisk: room.state.loopRisk,
  });

  pushUtterance(room, u);
  broadcast(room, { type: "speak", audioId, slot, uttId: u.id });
  broadcastState(room);
  return { done: turn.done, text: turn.text };
}

interface AgentTurnOutcome {
  done: boolean;
  text: string;
}

function estimateSpeechMs(text: string): number {
  return Math.min(11_000, 1400 + text.length * 55);
}

/** Auto-drive the two agents until done / stopped / max turns. */
async function runLoop(room: Room) {
  const token = ++room.loopToken;
  let count = 0;
  while (room.state.running && !room.state.done && count < MAX_RUN_TURNS) {
    if (room.loopToken !== token) return; // cancelled by a newer run/stop
    room.busy = true;
    let outcome: AgentTurnOutcome;
    try {
      outcome = await runOneTurn(room, room.state.floorOwner);
    } catch (err) {
      pushUtterance(room, {
        id: randomUUID().slice(0, 10),
        slot: "system",
        name: "system",
        text: `turn failed: ${String(err).slice(0, 140)}`,
        speechAct: "error",
        ts: Date.now(),
      });
      pushTrace(room, "guardrail_evaluated", "Auto-run halted on error.", { error: String(err).slice(0, 140) });
      room.state.running = false;
      room.busy = false;
      broadcastState(room);
      return;
    }
    room.busy = false;
    count += 1;
    if (outcome.done || !room.state.running) break;
    await sleep(estimateSpeechMs(outcome.text) + 350);
  }
  if (room.loopToken === token) {
    room.state.running = false;
    broadcastState(room);
  }
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

// ── request helpers ───────────────────────────────────────────────────
function readBody(req: IncomingMessage, maxBytes = MAX_BODY_BYTES): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (c: Buffer) => {
      size += c.length;
      if (size > maxBytes) {
        reject(new Error("body too large"));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}
async function readJson<T>(req: IncomingMessage): Promise<T> {
  const buf = await readBody(req);
  return buf.length ? (JSON.parse(buf.toString("utf8")) as T) : ({} as T);
}
function json(res: ServerResponse, status: number, body: unknown) {
  const s = JSON.stringify(body);
  res.writeHead(status, { "content-type": "application/json", "access-control-allow-origin": "*" });
  res.end(s);
}

// ── main router ───────────────────────────────────────────────────────
export async function handleLive(req: IncomingMessage, res: ServerResponse, path: string): Promise<boolean> {
  if (!path.startsWith("/live/")) return false;
  const method = req.method ?? "GET";

  // POST /live/rooms
  if (method === "POST" && path === "/live/rooms") {
    const body = await readJson<{ goal?: string; model?: string }>(req);
    const room = createRoom((body.goal ?? "").trim(), body.model);
    json(res, 200, { ok: true, roomId: room.id, room: publicRoom(room) });
    return true;
  }

  const m = path.match(/^\/live\/rooms\/([a-z0-9]+)(\/[a-z]+)?$/i);
  const audioM = path.match(/^\/live\/audio\/([a-z0-9]+)$/i);

  // GET /live/audio/:id  (search all rooms; audio ids are unique enough)
  if (method === "GET" && audioM) {
    const audioId = audioM[1]!;
    for (const room of ROOMS.values()) {
      const a = room.audio.get(audioId);
      if (a) {
        res.writeHead(200, { "content-type": a.mime, "cache-control": "public, max-age=3600", "access-control-allow-origin": "*" });
        res.end(a.buf);
        return true;
      }
    }
    json(res, 404, { ok: false, error: "audio not found" });
    return true;
  }

  if (!m) return false;
  const roomId = m[1]!;
  const sub = (m[2] ?? "").replace("/", "");
  const room = ROOMS.get(roomId);

  if (!room) {
    if (method === "GET" && path.endsWith("/events")) {
      res.writeHead(404, { "content-type": "text/plain" });
      res.end("room not found");
    } else {
      json(res, 404, { ok: false, error: "room not found" });
    }
    return true;
  }
  room.lastActivity = Date.now();

  // GET /live/rooms/:id/events  (SSE)
  if (method === "GET" && sub === "events") {
    if (room.sse.size >= MAX_SSE_PER_ROOM) {
      json(res, 429, { ok: false, error: "room is full" });
      return true;
    }
    res.writeHead(200, {
      "content-type": "text/event-stream",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      "access-control-allow-origin": "*",
      "x-accel-buffering": "no",
    });
    res.write(`retry: 3000\n\n`);
    sseSend(res, { type: "state", room: publicRoom(room) });
    room.sse.add(res);
    const ping = setInterval(() => {
      try {
        res.write(`: ping\n\n`);
      } catch {
        /* ignore */
      }
    }, 20_000);
    req.on("close", () => {
      clearInterval(ping);
      room.sse.delete(res);
    });
    return true;
  }

  // GET /live/rooms/:id  (snapshot)
  if (method === "GET" && sub === "") {
    json(res, 200, { ok: true, room: publicRoom(room) });
    return true;
  }

  // POST /live/rooms/:id/join
  if (method === "POST" && sub === "join") {
    const body = await readJson<{ slot?: Slot | "spectator"; kind?: string }>(req);
    const slot = body.slot === "a" || body.slot === "b" ? body.slot : "spectator";
    const pid = randomUUID().slice(0, 8);
    room.participants.set(pid, { slot, kind: body.kind ?? "device", lastSeen: Date.now() });
    broadcastState(room);
    json(res, 200, { ok: true, participantId: pid, slot, room: publicRoom(room) });
    return true;
  }

  // POST /live/rooms/:id/model  { model }
  if (method === "POST" && sub === "model") {
    const body = await readJson<{ model?: string }>(req);
    room.state.model = validModel(body.model);
    broadcastState(room);
    json(res, 200, { ok: true, room: publicRoom(room) });
    return true;
  }

  // POST /live/rooms/:id/goal
  if (method === "POST" && sub === "goal") {
    const body = await readJson<{ goal?: string }>(req);
    if (body.goal && body.goal.trim()) {
      room.state.goal = body.goal.trim().slice(0, 400);
      broadcastState(room);
    }
    json(res, 200, { ok: true, room: publicRoom(room) });
    return true;
  }

  // POST /live/rooms/:id/run   { running: boolean }
  if (method === "POST" && sub === "run") {
    const body = await readJson<{ running?: boolean }>(req);
    const running = Boolean(body.running);
    if (running && !room.state.running) {
      room.state.running = true;
      room.state.done = false;
      broadcastState(room);
      void runLoop(room);
    } else if (!running && room.state.running) {
      room.state.running = false;
      room.loopToken++; // cancel the active loop
      broadcastState(room);
    }
    json(res, 200, { ok: true, room: publicRoom(room) });
    return true;
  }

  // POST /live/rooms/:id/step   (advance exactly one turn)
  if (method === "POST" && sub === "step") {
    if (room.busy || room.state.running) {
      json(res, 409, { ok: false, error: "room is busy" });
      return true;
    }
    room.busy = true;
    try {
      await runOneTurn(room, room.state.floorOwner);
      json(res, 200, { ok: true, room: publicRoom(room) });
    } catch (err) {
      json(res, 502, { ok: false, error: String(err).slice(0, 200) });
    } finally {
      room.busy = false;
    }
    return true;
  }

  // POST /live/rooms/:id/human   (raw audio body, or JSON {text})
  if (method === "POST" && sub === "human") {
    const ct = (req.headers["content-type"] ?? "").toString();
    let text = "";
    try {
      if (ct.includes("application/json")) {
        const body = await readJson<{ text?: string }>(req);
        text = (body.text ?? "").trim();
      } else {
        const buf = await readBody(req);
        if (buf.length > 0) text = await transcribeAudio(buf, ct || "audio/webm");
      }
    } catch (err) {
      json(res, 502, { ok: false, error: `transcription failed: ${String(err).slice(0, 160)}` });
      return true;
    }
    if (!text) {
      json(res, 400, { ok: false, error: "empty utterance" });
      return true;
    }
    room.pendingHuman = text.slice(0, 400);
    pushTrace(room, "utterance_received", `you steered: ${text.slice(0, 80)}`, { text: text.slice(0, 400) });
    pushUtterance(room, {
      id: randomUUID().slice(0, 10),
      slot: "human",
      name: "you",
      text: text.slice(0, 400),
      speechAct: "steer",
      ts: Date.now(),
    });
    broadcastState(room);
    json(res, 200, { ok: true, text });
    return true;
  }

  json(res, 404, { ok: false, error: "unknown live route" });
  return true;
}

export const LIVE_AGENTS = AGENTS;
export const LIVE_DEFAULT_GOAL = DEFAULT_GOAL;
