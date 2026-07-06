/**
 * Live multi-device voice room.
 *
 * AI voice agents collaborate out loud
 * on a shared goal. A server-authoritative scheduler owns the floor and prevents
 * acknowledgement loops — the same thesis as the compare demo, but real:
 * separate devices, real speech (Whisper → LLM → ElevenLabs), one shared room.
 *
 * Transport is SSE (server→client) + POST (client→server): no extra deps, works
 * through a cloudflared tunnel, and works on iOS Safari.
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import { randomUUID } from "node:crypto";
import { generateAgentTurn, interpretHumanSteer, synthesizeSpeech, transcribeAudio, ROUTER_MODELS, DEFAULT_LLM_MODEL, type AgentVoice } from "./pipeline.js";
import {
  CAPABILITY_PROFILES,
  deriveCountTask,
  deriveHumanSteeringIntentFallback,
  goalFromHumanSteeringIntent,
  profileUsesRoomState,
  validProfile,
  type CapabilityProfile,
  type HumanSteeringIntent,
  type LiveCountTask,
} from "./steering.js";

function validModel(m?: string): string {
  return m && ROUTER_MODELS.some((x) => x.id === m) ? m : DEFAULT_LLM_MODEL;
}

type Slot = string;

interface AgentDef {
  slot: Slot;
  name: string;
  device: "laptop" | "phone";
  voice: AgentVoice;
  color: string;
  persona: string;
}

const LEGACY_SLOT_INDEX: Record<string, number> = { a: 1, b: 2, c: 3, d: 4, e: 5 };
const AGENT_NAMES = ["Ada", "Ben", "Cara", "Dev", "Eli", "Fay", "Gus", "Hana", "Ira", "Jo", "Kai", "Lea", "Mika", "Noor", "Owen", "Pia", "Quin", "Rae", "Sol", "Tess"];
const VOICES: AgentVoice[] = [
  { openai: "nova", eleven: "21m00Tcm4TlvDq8ikWAM" },
  { openai: "onyx", eleven: "pNInz6obpgDQGcFmaJgB" },
  { openai: "shimmer", eleven: "EXAVITQu4vr4xnSDxMaL" },
  { openai: "echo", eleven: "ErXwobaYiN019PkySvjV" },
  { openai: "fable", eleven: "MF3mGyEYCl7XYWbV9V6O" },
];
const AGENT_COLORS = ["sky", "violet", "emerald", "amber", "rose", "cyan", "lime", "pink", "orange", "indigo"];
const PERSONAS = [
  "A decisive planner. Proposes concrete, specific options with names and rough timing, and pushes to lock decisions.",
  "A thoughtful challenger. Asks one sharp question, checks constraints and budget, then refines the plan.",
  "A concise synthesizer. Tracks the shared state, resolves ambiguity, and turns partial ideas into crisp next steps.",
  "A practical operator. Checks feasibility, catches edge cases, and keeps the group moving without over-talking.",
  "A final reviewer. Looks for missing constraints, confirms decisions, and helps close tasks cleanly.",
  "A creative scout. Offers one fresh option when the room is stuck, then hands the floor back to execution.",
  "A systems thinker. Notices dependencies, sequencing, and failure modes before they become expensive.",
  "A user advocate. Keeps the conversation grounded in what a real person would understand and do next.",
];

const DEFAULT_AGENT_COUNT = 2;
const MIN_AGENT_COUNT = 1;
const MAX_AGENT_COUNT = 100;

function validAgentCount(value?: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return DEFAULT_AGENT_COUNT;
  return Math.max(MIN_AGENT_COUNT, Math.min(MAX_AGENT_COUNT, Math.trunc(value)));
}

function slotForIndex(index: number): Slot {
  const n = Math.max(1, Math.min(MAX_AGENT_COUNT, Math.trunc(index)));
  return `agent-${String(n).padStart(3, "0")}`;
}

function agentIndexFromSlot(slot: string): number | null {
  if (slot in LEGACY_SLOT_INDEX) return LEGACY_SLOT_INDEX[slot]!;
  const match = /^agent-(\d{3})$/.exec(slot);
  if (!match) return null;
  const n = Number(match[1]);
  return Number.isInteger(n) && n >= 1 && n <= MAX_AGENT_COUNT ? n : null;
}

function activeSlots(agentCount?: number): Slot[] {
  return Array.from({ length: validAgentCount(agentCount) }, (_, i) => slotForIndex(i + 1));
}

function isAgentSlot(value: unknown): value is Slot {
  return typeof value === "string" && agentIndexFromSlot(value) !== null;
}

function nextSlot(slot: Slot, agentCount?: number): Slot {
  const slots = activeSlots(agentCount);
  const index = agentIndexFromSlot(slot);
  const current = index && index <= slots.length ? index - 1 : 0;
  return slots[(current + 1) % slots.length]!;
}

function agentForSlot(slot: Slot): AgentDef {
  const index = agentIndexFromSlot(slot) ?? 1;
  const nameBase = AGENT_NAMES[(index - 1) % AGENT_NAMES.length]!;
  const cycle = Math.floor((index - 1) / AGENT_NAMES.length);
  return {
    slot: slotForIndex(index),
    name: cycle === 0 ? nameBase : `${nameBase} ${cycle + 1}`,
    device: index === 1 ? "laptop" : "phone",
    voice: VOICES[(index - 1) % VOICES.length]!,
    color: AGENT_COLORS[(index - 1) % AGENT_COLORS.length]!,
    persona: PERSONAS[(index - 1) % PERSONAS.length]!,
  };
}

const AGENTS: Record<Slot, AgentDef> = new Proxy({} as Record<Slot, AgentDef>, {
  get(_target, prop) {
    return agentForSlot(String(prop));
  },
});

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
  agentCount: number;
  profile: CapabilityProfile;
  /** private = unlisted from the lobby; joinable only via link/QR/code */
  private: boolean;
  floorOwner: Slot;
  turn: number;
  goalVersion: number;
  runStartTurn: number;
  running: boolean;
  done: boolean;
  loopRisk: boolean;
  recentActs: string[];
  countTarget?: number;
  countNext?: number;
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
  pendingHumanSeq: number;
  loopToken: number; // increments to cancel a stale run loop
  busy: boolean;
  inFlightTurns: number;
}

// ── bounded registries ────────────────────────────────────────────────
const ROOMS = new Map<string, Room>();
const MAX_ROOMS = 40;
const MAX_UTTERANCES = 300;
const MAX_TRACES = 60;
const MAX_AUDIO_PER_ROOM = 60;
const MAX_SSE_PER_ROOM = 30;
const MAX_RUN_TURNS = 320;
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

function applyGoal(room: Room, goal: string): boolean {
  const nextGoal = goal.trim().slice(0, 400);
  if (!nextGoal || nextGoal === room.state.goal) return false;
  const task = profileUsesRoomState(room.state.profile) ? deriveCountTask(nextGoal) : null;
  room.state.goal = nextGoal;
  room.state.goalVersion += 1;
  room.state.done = false;
  room.state.loopRisk = false;
  room.state.recentActs = [];
  if (task) {
    room.state.countTarget = task.target;
    room.state.countNext = task.next;
  } else {
    delete room.state.countTarget;
    delete room.state.countNext;
  }
  return true;
}

function currentCountTask(room: Room): LiveCountTask | null {
  if (!profileUsesRoomState(room.state.profile)) return null;
  if (typeof room.state.countTarget !== "number" || typeof room.state.countNext !== "number") return null;
  return { kind: "count_to_n", target: room.state.countTarget, next: room.state.countNext };
}

function profileLabel(profile: CapabilityProfile): string {
  const p = CAPABILITY_PROFILES.find((option) => option.id === profile);
  return p ? `${p.shortLabel} ${p.label}` : profile;
}

function createRoom(goal: string, model?: string, isPrivate?: boolean, profileInput?: string, agentCountInput?: number): Room {
  evictIfNeeded();
  const id = shortId();
  const initialGoal = goal || DEFAULT_GOAL;
  const profile = validProfile(profileInput);
  const agentCount = validAgentCount(agentCountInput);
  const countTask = profileUsesRoomState(profile) ? deriveCountTask(initialGoal) : null;
  const room: Room = {
    id,
    createdAt: Date.now(),
    lastActivity: Date.now(),
    state: {
      goal: initialGoal,
      model: validModel(model),
      agentCount,
      profile,
      private: isPrivate === true,
      floorOwner: slotForIndex(1),
      turn: 0,
      goalVersion: 0,
      runStartTurn: 0,
      running: false,
      done: false,
      loopRisk: false,
      recentActs: [],
      ...(countTask ? { countTarget: countTask.target, countNext: countTask.next } : {}),
    },
    utterances: [],
    traces: [],
    audio: new Map(),
    participants: new Map(),
    sse: new Set(),
    pendingHuman: null,
    pendingHumanSeq: 0,
    loopToken: 0,
    busy: false,
    inFlightTurns: 0,
  };
  pushTrace(room, "state_reduced", "Room created.", { goal: room.state.goal, model: room.state.model, profile, agentCount });
  pushUtterance(room, {
    id: randomUUID().slice(0, 10),
    slot: "system",
    name: "system",
    text: `Room created. Share code ${id} or scan the QR to add another device.`,
    speechAct: "system",
    ts: Date.now(),
  });
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
    code: room.id, // node room ids are already short + human-typeable
    private: room.state.private,
    agents: Object.fromEntries(activeSlots(room.state.agentCount).map((slot) => [slot, pickAgent(agentForSlot(slot))])),
    state: {
      goal: room.state.goal,
      model: room.state.model,
      agentCount: room.state.agentCount,
      profile: room.state.profile,
      floorOwner: room.state.floorOwner,
      nextSpeaker: room.state.floorOwner,
      turn: room.state.turn,
      running: room.state.running,
      done: room.state.done,
      loopRisk: room.state.loopRisk,
      nextRequiredAct: "task_action",
      suppressAcknowledgements: true,
      task:
        typeof room.state.countTarget === "number" && typeof room.state.countNext === "number"
          ? {
              kind: "count_to_n" as const,
              target: room.state.countTarget,
              next: room.state.countNext,
              completed: room.state.done && room.state.countNext >= room.state.countTarget,
            }
          : null,
    },
    models: ROUTER_MODELS,
    profiles: CAPABILITY_PROFILES,
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

function beginTurn(room: Room) {
  room.inFlightTurns += 1;
  room.busy = true;
}

function endTurn(room: Room) {
  room.inFlightTurns = Math.max(0, room.inFlightTurns - 1);
  room.busy = room.inFlightTurns > 0;
}

function dropAudio(room: Room, audioId: string | undefined) {
  if (audioId) room.audio.delete(audioId);
}

function noteRunCap(room: Room) {
  const text = `Auto-run paused after ${MAX_RUN_TURNS} turns in this run. Press Start to continue.`;
  pushUtterance(room, {
    id: randomUUID().slice(0, 10),
    slot: "system",
    name: "system",
    text,
    speechAct: "system",
    ts: Date.now(),
  });
  pushTrace(room, "guardrail_evaluated", "Auto-run paused at the per-run turn cap.", { maxRunTurns: MAX_RUN_TURNS });
}

function joinNotice(slot: Slot | "spectator", kind?: string): string {
  if (kind === "creator") return "Room created. Ada joined on this device.";
  if (isAgentSlot(slot)) return `${agentForSlot(slot).name} joined the room.`;
  return "A spectator joined the room.";
}

function allocateJoinSlot(room: Room, requested?: string): Slot | "spectator" {
  if (requested === "spectator") return "spectator";
  const requestedIndex = requested && isAgentSlot(requested) ? agentIndexFromSlot(requested) : null;
  if (requestedIndex) {
    room.state.agentCount = Math.max(room.state.agentCount, requestedIndex);
    return slotForIndex(requestedIndex);
  }
  const claimed = new Set(
    [...room.participants.values()].map((p) => p.slot).filter(isAgentSlot).map((slot) => slotForIndex(agentIndexFromSlot(slot)!)),
  );
  for (const slot of activeSlots(room.state.agentCount)) {
    if (!claimed.has(slot)) return slot;
  }
  if (room.state.agentCount >= MAX_AGENT_COUNT) return "spectator";
  room.state.agentCount += 1;
  return slotForIndex(room.state.agentCount);
}

// ── one agent turn ────────────────────────────────────────────────────
async function interpretAndApplyHuman(room: Room, text: string, seq: number) {
  let intent: HumanSteeringIntent;
  let source = "llm";
  try {
    intent = await interpretHumanSteer({
      text,
      currentGoal: room.state.goal,
      model: room.state.model,
      profile: room.state.profile,
      transcript: room.utterances.map((u) => ({ name: u.name, text: u.text })),
    });
  } catch (err) {
    source = "fallback";
    intent = deriveHumanSteeringIntentFallback(text);
    pushTrace(room, "guardrail_evaluated", "LLM intent interpreter failed; used deterministic fallback.", {
      error: String(err).slice(0, 160),
    });
  }

  if (room.pendingHumanSeq !== seq || room.pendingHuman !== text) {
    pushTrace(room, "guardrail_evaluated", "Ignored stale human-intent interpretation.", {
      source,
      seq,
      currentSeq: room.pendingHumanSeq,
    });
    broadcastState(room);
    return;
  }

  const goalOverride = goalFromHumanSteeringIntent(intent);
  let stateChanged = false;
  let resumeToken: number | null = null;
  if (goalOverride && applyGoal(room, goalOverride)) {
    stateChanged = true;
    pushTrace(room, "state_reduced", "Human retargeted the room goal.", { goal: room.state.goal, source, task: currentCountTask(room) });
  }

  if (intent.kind === "count_task" && goalOverride && goalOverride === room.state.goal && (room.state.done || currentCountTask(room) === null)) {
    room.state.done = false;
    room.state.loopRisk = false;
    room.state.recentActs = [];
    const task = profileUsesRoomState(room.state.profile) ? deriveCountTask(goalOverride) : null;
    if (task) {
      room.state.countTarget = task.target;
      room.state.countNext = task.next;
    } else {
      delete room.state.countTarget;
      delete room.state.countNext;
    }
    stateChanged = true;
  }

  if (intent.kind === "control") {
    if ((intent.action === "pause" || intent.action === "stop") && room.state.running) {
      room.state.running = false;
      room.loopToken += 1;
      stateChanged = true;
    }
    if ((intent.action === "start" || intent.action === "resume") && !room.state.running) {
      room.state.done = false;
      room.state.loopRisk = false;
      room.state.recentActs = [];
      room.state.running = true;
      room.state.runStartTurn = room.state.turn;
      resumeToken = ++room.loopToken;
      stateChanged = true;
    }
  }

  const shouldResumeForIntent =
    !room.state.running &&
    resumeToken === null &&
    (intent.kind === "count_task" || intent.kind === "retarget" || intent.kind === "constraint" || intent.kind === "question");
  if (shouldResumeForIntent) {
    room.state.done = false;
    room.state.loopRisk = false;
    room.state.recentActs = [];
    room.state.running = true;
    room.state.runStartTurn = room.state.turn;
    resumeToken = ++room.loopToken;
    stateChanged = true;
  }

  pushTrace(room, "intent_interpreted", `Human steer interpreted as ${intent.kind}.`, {
    source,
    intent,
    goalOverride,
    stateChanged,
    profile: room.state.profile,
  });
  if (resumeToken !== null) {
    pushTrace(room, "scheduler_selected", "Auto-run resumed by human intent.", { floorOwner: room.state.floorOwner, intent: intent.kind });
    void runLoop(room, resumeToken);
  }
  broadcastState(room);
}

async function runOneTurn(room: Room, slot: Slot, token?: number): Promise<AgentTurnOutcome> {
  const agent = agentForSlot(slot);
  const other = agentForSlot(nextSlot(slot, room.state.agentCount));
  const goalAtStart = room.state.goal;
  const goalVersionAtStart = room.state.goalVersion;
  const humanNote = room.pendingHuman ?? undefined;
  const countTask = currentCountTask(room);

  const turn = await generateAgentTurn({
    goal: goalAtStart,
    profile: room.state.profile,
    persona: agent.persona,
    selfName: agent.name,
    otherName: other.name,
    transcript: room.utterances.map((u) => ({ name: u.name, text: u.text })),
    humanNote,
    recentActs: room.state.recentActs,
    model: room.state.model,
    countTask,
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

  if (room.state.done) {
    dropAudio(room, audioId);
    return { done: true, text: turn.text, committed: false, reason: "done" };
  }
  if (token !== undefined && (room.loopToken !== token || !room.state.running)) {
    dropAudio(room, audioId);
    return { done: false, text: turn.text, committed: false, reason: "stale token / paused" };
  }
  if (room.state.floorOwner !== slot) {
    dropAudio(room, audioId);
    return { done: false, text: turn.text, committed: false, reason: "lost floor" };
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
  const recentTwo = room.state.recentActs.slice(-2);
  room.state.loopRisk = recentTwo.length === 2 && recentTwo.every((a) => a === "backchannel");
  room.state.floorOwner = nextSlot(slot, room.state.agentCount);
  const goalUnchanged = room.state.goal === goalAtStart && room.state.goalVersion === goalVersionAtStart;
  const liveCountTask = currentCountTask(room);
  const countCommitted =
    goalUnchanged &&
    countTask !== null &&
    liveCountTask !== null &&
    liveCountTask.target === countTask.target &&
    liveCountTask.next === countTask.next;
  const countDone = countCommitted && countTask ? countTask.next >= countTask.target : false;
  const effectiveDone = countTask ? countDone : goalUnchanged && turn.done;
  if (countCommitted && countTask) {
    room.state.countNext = Math.min(countTask.next + 1, countTask.target);
  }
  if (effectiveDone) room.state.done = true;
  if (humanNote !== undefined && room.pendingHuman === humanNote) room.pendingHuman = null;

  if (turn.speechAct === "backchannel") {
    pushTrace(room, "guardrail_evaluated", "Backchannel — not counted as progress.", { text: turn.text });
  }
  pushTrace(room, "state_reduced", `${agent.name} took the floor turn ${room.state.turn}.`, {
    speechAct: turn.speechAct,
    done: effectiveDone,
    task: countCommitted ? countTask : null,
  });
  pushTrace(room, "scheduler_selected", `${agentForSlot(room.state.floorOwner).name} owns the next floor.`, {
    floorOwner: room.state.floorOwner,
    loopRisk: room.state.loopRisk,
  });

  pushUtterance(room, u);
  broadcast(room, { type: "speak", audioId, slot, uttId: u.id });
  broadcastState(room);
  return { done: effectiveDone, text: turn.text, committed: true };
}

interface AgentTurnOutcome {
  done: boolean;
  text: string;
  committed: boolean;
  reason?: string;
}

function estimateSpeechMs(text: string): number {
  return Math.min(11_000, 1400 + text.length * 55);
}

/** Auto-drive the two agents until done / stopped / max turns. */
async function runLoop(room: Room, token: number) {
  while (room.state.running && !room.state.done && room.state.turn - room.state.runStartTurn < MAX_RUN_TURNS) {
    if (room.loopToken !== token) return; // cancelled by a newer run/stop
    beginTurn(room);
    let outcome: AgentTurnOutcome;
    try {
      outcome = await runOneTurn(room, room.state.floorOwner, token);
    } catch (err) {
      endTurn(room);
      if (room.loopToken !== token) return;
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
      broadcastState(room);
      return;
    }
    endTurn(room);
    if (!outcome.committed) {
      if (outcome.reason === "lost floor" && room.loopToken === token && room.state.running && !room.state.done) continue;
      return;
    }
    if (room.state.done || outcome.done || !room.state.running) break;
    await sleep(estimateSpeechMs(outcome.text) + 350);
  }
  if (room.loopToken === token) {
    if (room.state.running && !room.state.done && room.state.turn - room.state.runStartTurn >= MAX_RUN_TURNS) {
      noteRunCap(room);
    }
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
    const body = await readJson<{ goal?: string; model?: string; private?: boolean; profile?: string; agentCount?: number }>(req);
    const room = createRoom((body.goal ?? "").trim(), body.model, body.private === true, body.profile, body.agentCount);
    json(res, 200, { ok: true, roomId: room.id, room: publicRoom(room) });
    return true;
  }

  // GET /live/rooms — joinable rooms for the lobby (active in the last hour)
  if (method === "GET" && path === "/live/rooms") {
    const cutoff = Date.now() - 60 * 60 * 1000;
    const rooms = [...ROOMS.values()]
      .filter((r) => r.lastActivity > cutoff && !r.state.private)
      .sort((a, b) => b.lastActivity - a.lastActivity)
      .slice(0, 8)
      .map((r) => ({
        id: r.id,
        code: r.id,
        goal: r.state.goal,
        agentCount: r.state.agentCount,
        profile: r.state.profile,
        turn: r.state.turn,
        running: r.state.running,
        done: r.state.done,
        updatedAt: r.lastActivity,
      }));
    json(res, 200, { ok: true, rooms });
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
    const body = await readJson<{ slot?: string; kind?: string }>(req);
    const slot = allocateJoinSlot(room, body.slot);
    const pid = randomUUID().slice(0, 8);
    room.participants.set(pid, { slot, kind: body.kind ?? "device", lastSeen: Date.now() });
    pushUtterance(room, {
      id: randomUUID().slice(0, 10),
      slot: "system",
      name: "system",
      text: joinNotice(slot, body.kind),
      speechAct: "system",
      ts: Date.now(),
    });
    pushTrace(room, "state_reduced", "Participant joined the room.", { slot, kind: body.kind ?? "device" });
    broadcastState(room);
    json(res, 200, { ok: true, participantId: pid, slot, room: publicRoom(room) });
    return true;
  }

  // POST /live/rooms/:id/agents  { agentCount } or { delta }
  if (method === "POST" && sub === "agents") {
    const body = await readJson<{ agentCount?: number; delta?: number }>(req);
    const requested = typeof body.agentCount === "number" ? body.agentCount : room.state.agentCount + (typeof body.delta === "number" ? body.delta : 1);
    const nextCount = validAgentCount(requested);
    if (nextCount !== room.state.agentCount) {
      const floorIndex = agentIndexFromSlot(room.state.floorOwner) ?? 1;
      if (floorIndex > nextCount) room.state.floorOwner = slotForIndex(1);
      room.state.agentCount = nextCount;
      room.lastActivity = Date.now();
      pushTrace(room, "state_reduced", "Agent roster resized.", { agentCount: nextCount, floorOwner: room.state.floorOwner });
      pushUtterance(room, {
        id: randomUUID().slice(0, 10),
        slot: "system",
        name: "system",
        text: `Agent roster is now ${nextCount}.`,
        speechAct: "system",
        ts: Date.now(),
      });
      broadcastState(room);
    }
    json(res, 200, { ok: true, room: publicRoom(room) });
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

  // POST /live/rooms/:id/profile  { profile }
  if (method === "POST" && sub === "profile") {
    const body = await readJson<{ profile?: string }>(req);
    const profile = validProfile(body.profile);
    if (profile !== room.state.profile) {
      room.state.profile = profile;
      room.state.goalVersion += 1;
      room.state.done = false;
      room.state.loopRisk = false;
      room.state.recentActs = [];
      const task = profileUsesRoomState(profile) ? deriveCountTask(room.state.goal) : null;
      if (task) {
        room.state.countTarget = task.target;
        room.state.countNext = task.next;
      } else {
        delete room.state.countTarget;
        delete room.state.countNext;
      }
      pushTrace(room, "state_reduced", "Capability profile changed.", { profile, task });
      pushUtterance(room, {
        id: randomUUID().slice(0, 10),
        slot: "system",
        name: "system",
        text: `Agent version switched to ${profileLabel(profile)}.`,
        speechAct: "system",
        ts: Date.now(),
      });
    }
    broadcastState(room);
    json(res, 200, { ok: true, room: publicRoom(room) });
    return true;
  }

  // POST /live/rooms/:id/goal
  if (method === "POST" && sub === "goal") {
    const body = await readJson<{ goal?: string }>(req);
    if (body.goal && body.goal.trim()) {
      if (applyGoal(room, body.goal.trim().slice(0, 400))) {
        pushTrace(room, "state_reduced", "Goal updated.", { goal: room.state.goal, task: currentCountTask(room) });
        broadcastState(room);
      }
    }
    json(res, 200, { ok: true, room: publicRoom(room) });
    return true;
  }

  // POST /live/rooms/:id/run   { running: boolean }
  if (method === "POST" && sub === "run") {
    const body = await readJson<{ running?: boolean }>(req);
    const running = Boolean(body.running);
    if (running && !room.state.running) {
      if (!room.state.done) {
        room.state.running = true;
        room.state.runStartTurn = room.state.turn;
        const token = ++room.loopToken;
        broadcastState(room);
        void runLoop(room, token);
      }
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
    if (room.state.done) {
      json(res, 409, { ok: false, error: "room is done" });
      return true;
    }
    beginTurn(room);
    try {
      const outcome = await runOneTurn(room, room.state.floorOwner);
      if (!outcome.committed) {
        json(res, 409, { ok: false, error: outcome.reason ?? "turn did not commit" });
        return true;
      }
      json(res, 200, { ok: true, room: publicRoom(room) });
    } catch (err) {
      json(res, 502, { ok: false, error: String(err).slice(0, 200) });
    } finally {
      endTurn(room);
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
    const clipped = text.slice(0, 400);
    room.pendingHuman = clipped;
    room.pendingHumanSeq += 1;
    const seq = room.pendingHumanSeq;
    pushTrace(room, "utterance_received", `you steered: ${text.slice(0, 80)}`, {
      text: clipped,
      profile: room.state.profile,
      intentPending: profileUsesRoomState(room.state.profile),
      pendingHumanSeq: seq,
    });
    pushUtterance(room, {
      id: randomUUID().slice(0, 10),
      slot: "human",
      name: "you",
      text: clipped,
      speechAct: "steer",
      ts: Date.now(),
    });
    if (profileUsesRoomState(room.state.profile)) {
      void interpretAndApplyHuman(room, clipped, seq);
    } else {
      pushTrace(room, "intent_interpreted", "V0 profile left human steer as raw transcript context.", {
        text: clipped,
        source: "profile",
        intent: { kind: "none", reason: "v0_no_room_state does not mutate durable room state" },
      });
    }
    broadcastState(room);
    json(res, 200, { ok: true, text });
    return true;
  }

  json(res, 404, { ok: false, error: "unknown live route" });
  return true;
}

export const LIVE_AGENTS = AGENTS;
export const LIVE_DEFAULT_GOAL = DEFAULT_GOAL;
