import { v } from "convex/values";
import { query, mutation, internalQuery, internalMutation, type QueryCtx, type MutationCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { AGENTS, ROUTER_MODELS, DEFAULT_GOAL, DEFAULT_MODEL, validModel, other, makeRoomCode, deriveCountTask, deriveGoalOverrideFromHuman, type CountTask, type Slot } from "./shared";

const MAX_TRACES = 300;
const MAX_UTTERANCES = 300;
const MAX_AUTO_RUN_TURNS = 140;

async function insertTrace(ctx: MutationCtx, roomId: Id<"rooms">, kind: string, summary: string, payload: unknown) {
  await ctx.db.insert("traces", { roomId, kind, summary, payload, createdAt: Date.now() });
  // BOUND: keep the table from growing without limit under agent loops.
  const all = await ctx.db.query("traces").withIndex("by_room", (q) => q.eq("roomId", roomId)).collect();
  if (all.length > MAX_TRACES) {
    for (const t of all.slice(0, all.length - MAX_TRACES)) await ctx.db.delete(t._id);
  }
}

async function boundUtterances(ctx: MutationCtx, roomId: Id<"rooms">) {
  const all = await ctx.db.query("utterances").withIndex("by_room", (q) => q.eq("roomId", roomId)).collect();
  if (all.length > MAX_UTTERANCES) {
    for (const u of all.slice(0, all.length - MAX_UTTERANCES)) {
      // free the TTS blob too — evicting only the row leaks file storage
      if (u.audioId) {
        try {
          await ctx.storage.delete(u.audioId);
        } catch {
          /* already gone */
        }
      }
      await ctx.db.delete(u._id);
    }
  }
}

function agentPublic(slot: Slot) {
  const a = AGENTS[slot];
  return { slot: a.slot, name: a.name, device: a.device, persona: a.persona, color: slot === "a" ? "sky" : "violet" };
}

function currentCountTask(room: { countTarget?: number; countNext?: number }): CountTask | null {
  if (typeof room.countTarget !== "number" || typeof room.countNext !== "number") return null;
  return { kind: "count_to_n", target: room.countTarget, next: room.countNext };
}

function countPatchForGoal(goal: string): { countTarget?: number; countNext?: number } {
  const task = deriveCountTask(goal);
  return task ? { countTarget: task.target, countNext: task.next } : { countTarget: undefined, countNext: undefined };
}

/** Shared serializer used by the reactive query and the HTTP bridge. */
async function serializeRoom(ctx: QueryCtx, roomId: Id<"rooms">) {
  const room = await ctx.db.get(roomId);
  if (!room) return null;
  const participants = await ctx.db.query("participants").withIndex("by_room", (q) => q.eq("roomId", roomId)).collect();
  const utterances = await ctx.db.query("utterances").withIndex("by_room", (q) => q.eq("roomId", roomId)).order("asc").collect();
  // ride the proof layer along with the snapshot (newest 40) so the Trace
  // Inspector is reactive for free — every mutation pushes fresh traces too
  const traceRows = await ctx.db.query("traces").withIndex("by_room", (q) => q.eq("roomId", roomId)).order("desc").take(40);
  const traces = traceRows.reverse().map((t) => ({ id: t._id, kind: t.kind, summary: t.summary, payload: t.payload, ts: t.createdAt }));
  const resolved = await Promise.all(
    utterances.map(async (u) => ({
      id: u._id,
      slot: u.slot,
      name: u.name,
      text: u.text,
      speechAct: u.speechAct,
      ts: u.createdAt,
      audioId: u.audioId ?? undefined,
      audioUrl: u.audioId ? await ctx.storage.getUrl(u.audioId) : undefined,
    })),
  );
  return {
    id: room._id,
    code: room.code,
    private: room.private === true,
    agents: { a: agentPublic("a"), b: agentPublic("b") },
    state: {
      goal: room.goal,
      model: room.model,
      floorOwner: room.floorOwner,
      nextSpeaker: room.floorOwner,
      turn: room.turn,
      running: room.running,
      done: room.done,
      loopRisk: room.loopRisk,
      nextRequiredAct: "task_action",
      suppressAcknowledgements: true,
      task:
        typeof room.countTarget === "number" && typeof room.countNext === "number"
          ? {
              kind: "count_to_n" as const,
              target: room.countTarget,
              next: room.countNext,
              completed: room.done && room.countNext >= room.countTarget,
            }
          : null,
    },
    models: ROUTER_MODELS,
    participants: participants.map((p) => ({ slot: p.slot, kind: p.kind })),
    utterances: resolved,
    traces,
  };
}

// ── queries ───────────────────────────────────────────────────────────
export const watchRoom = query({
  args: { roomId: v.id("rooms") },
  handler: (ctx, args) => serializeRoom(ctx, args.roomId),
});

/** Joinable rooms for the lobby: active in the last hour, newest first. */
export const listActiveRooms = query({
  args: {},
  handler: async (ctx) => {
    const cutoff = Date.now() - 60 * 60 * 1000;
    const rooms = await ctx.db
      .query("rooms")
      .withIndex("by_activity", (q) => q.gt("updatedAt", cutoff))
      // private rooms are unlisted — joinable only via link/QR/code
      .filter((q) => q.neq(q.field("private"), true))
      .order("desc")
      .take(8);
    return rooms.map((r) => ({
      id: r._id,
      code: r.code,
      goal: r.goal,
      turn: r.turn,
      running: r.running,
      done: r.done,
      updatedAt: r.updatedAt,
    }));
  },
});

/** Resolve a typed join code to a room id (case-insensitive). */
export const roomIdByCode = query({
  args: { code: v.string() },
  handler: async (ctx, args) => {
    const code = args.code.trim().toLowerCase();
    if (!code) return null;
    const room = await ctx.db
      .query("rooms")
      .withIndex("by_code", (q) => q.eq("code", code))
      .first();
    return room ? room._id : null;
  },
});

export const listTraces = query({
  args: { roomId: v.id("rooms"), limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const traces = await ctx.db
      .query("traces")
      .withIndex("by_room", (q) => q.eq("roomId", args.roomId))
      .order("desc")
      .take(args.limit ?? 60);
    return traces.reverse().map((t) => ({ id: t._id, kind: t.kind, summary: t.summary, payload: t.payload, ts: t.createdAt }));
  },
});

/** Raw room read for the coordinator action (internal). */
export const getRoomRaw = internalQuery({
  args: { roomId: v.id("rooms") },
  handler: (ctx, args) => ctx.db.get(args.roomId),
});

// ── mutations ─────────────────────────────────────────────────────────
export const createRoom = mutation({
  args: { goal: v.optional(v.string()), model: v.optional(v.string()), private: v.optional(v.boolean()) },
  handler: async (ctx, args) => {
    const now = Date.now();
    const goal = (args.goal ?? "").trim() || DEFAULT_GOAL;
    const countTask = deriveCountTask(goal);
    // unique short join code (retry on the rare collision)
    let code = makeRoomCode();
    for (let i = 0; i < 4; i += 1) {
      const clash = await ctx.db.query("rooms").withIndex("by_code", (q) => q.eq("code", code)).first();
      if (!clash) break;
      code = makeRoomCode();
    }
    const roomId = await ctx.db.insert("rooms", {
      goal,
      model: validModel(args.model),
      code,
      private: args.private === true,
      floorOwner: "a",
      turn: 0,
      running: false,
      done: false,
      loopRisk: false,
      recentActs: [],
      ...(countTask ? { countTarget: countTask.target, countNext: countTask.next } : {}),
      runToken: 0,
      createdAt: now,
      updatedAt: now,
    });
    await insertTrace(ctx, roomId, "state_reduced", "Room created.", { goal, task: countTask });
    return roomId;
  },
});

export const joinRoom = mutation({
  args: { roomId: v.id("rooms"), slot: v.union(v.literal("a"), v.literal("b"), v.literal("spectator")), kind: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const id = await ctx.db.insert("participants", { roomId: args.roomId, slot: args.slot, kind: args.kind ?? "device", joinedAt: Date.now() });
    return id;
  },
});

export const setGoal = mutation({
  args: { roomId: v.id("rooms"), goal: v.string() },
  handler: async (ctx, args) => {
    const g = args.goal.trim().slice(0, 400);
    if (g) {
      const countPatch = countPatchForGoal(g);
      await ctx.db.patch(args.roomId, { goal: g, done: false, loopRisk: false, recentActs: [], ...countPatch, updatedAt: Date.now() });
      await insertTrace(ctx, args.roomId, "state_reduced", "Goal updated.", { goal: g, task: deriveCountTask(g) });
    }
  },
});

export const setModel = mutation({
  args: { roomId: v.id("rooms"), model: v.string() },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.roomId, { model: validModel(args.model), updatedAt: Date.now() });
  },
});

export const submitHuman = mutation({
  args: { roomId: v.id("rooms"), text: v.string() },
  handler: async (ctx, args) => {
    const text = args.text.trim().slice(0, 400);
    if (!text) return;
    const goalOverride = deriveGoalOverrideFromHuman(text);
    const patch: {
      pendingHuman: string;
      updatedAt: number;
      goal?: string;
      done?: boolean;
      loopRisk?: boolean;
      recentActs?: string[];
      countTarget?: number;
      countNext?: number;
    } = { pendingHuman: text, updatedAt: Date.now() };
    if (goalOverride) {
      Object.assign(patch, {
        goal: goalOverride,
        done: false,
        loopRisk: false,
        recentActs: [],
        ...countPatchForGoal(goalOverride),
      });
    }
    await ctx.db.insert("utterances", { roomId: args.roomId, slot: "human", name: "you", text, speechAct: "steer", createdAt: Date.now() });
    await ctx.db.patch(args.roomId, patch);
    if (goalOverride) {
      await insertTrace(ctx, args.roomId, "state_reduced", "Human retargeted the room goal.", { goal: goalOverride, task: deriveCountTask(goalOverride) });
    }
    await insertTrace(ctx, args.roomId, "utterance_received", `you said: ${text}`, { text, goalOverride });
    await boundUtterances(ctx, args.roomId);
  },
});

/** Start/stop the durable auto-run. Uses scheduler hops, not an in-action loop. */
export const setRunning = mutation({
  args: { roomId: v.id("rooms"), running: v.boolean() },
  handler: async (ctx, args) => {
    const room = await ctx.db.get(args.roomId);
    if (!room) return;
    if (args.running) {
      // idempotent: a second Start (double-click, second device) must not
      // spawn a parallel hop chain
      if (room.running) return;
      const token = room.runToken + 1;
      await ctx.db.patch(args.roomId, { running: true, done: false, runToken: token, updatedAt: Date.now() });
      await insertTrace(ctx, args.roomId, "scheduler_selected", "Auto-run started.", { floorOwner: room.floorOwner });
      await ctx.scheduler.runAfter(0, internal.coordinator.runTurn, { roomId: args.roomId, token });
    } else {
      if (!room.running) return;
      // bump the token so any in-flight scheduled hop no-ops
      await ctx.db.patch(args.roomId, { running: false, runToken: room.runToken + 1, updatedAt: Date.now() });
    }
  },
});

/**
 * The reducer: append the agent's turn and advance the room. Called by the
 * action AFTER seconds of non-transactional LLM/TTS work, so it re-validates
 * everything here — a stale hop (paused, superseded token, lost floor) must
 * never commit. Returns { committed } so the caller can stop its chain.
 */
export const commitAgentTurn = internalMutation({
  args: {
    roomId: v.id("rooms"),
    slot: v.union(v.literal("a"), v.literal("b")),
    text: v.string(),
    speechAct: v.string(),
    done: v.boolean(),
    goal: v.string(),
    audioId: v.optional(v.id("_storage")),
    /** auto-run hop token; omitted for manual stepOnce */
    token: v.optional(v.number()),
    /** the pendingHuman value this turn actually incorporated (if any) */
    consumedHuman: v.optional(v.string()),
    countTarget: v.optional(v.number()),
    countNext: v.optional(v.number()),
  },
  handler: async (ctx, args): Promise<{ committed: boolean; reason?: string }> => {
    const room = await ctx.db.get(args.roomId);
    if (!room) return { committed: false, reason: "room gone" };
    // stale-hop guards: floor must still be ours; auto-run hops must still
    // hold the current token on a running room
    if (room.floorOwner !== args.slot) {
      if (args.audioId) {
        try {
          await ctx.storage.delete(args.audioId);
        } catch {
          /* ignore */
        }
      }
      return { committed: false, reason: "lost floor" };
    }
    if (args.token !== undefined && (!room.running || room.runToken !== args.token)) {
      if (args.audioId) {
        try {
          await ctx.storage.delete(args.audioId);
        } catch {
          /* ignore */
        }
      }
      return { committed: false, reason: "stale token / paused" };
    }
    const name = AGENTS[args.slot].name;

    await ctx.db.insert("utterances", {
      roomId: args.roomId,
      slot: args.slot,
      name,
      text: args.text,
      speechAct: args.speechAct,
      audioId: args.audioId,
      createdAt: Date.now(),
    });

    const recentActs = [...room.recentActs, args.speechAct].slice(-4);
    const loopRisk = recentActs.slice(-2).length === 2 && recentActs.slice(-2).every((a) => a === "backchannel");
    const next = other(args.slot as Slot);
    const goalUnchanged = room.goal === args.goal;
    const countTask = currentCountTask(room);
    const countCommitted =
      goalUnchanged && countTask !== null && args.countTarget === countTask.target && args.countNext === countTask.next;
    const countDone = countCommitted && countTask ? countTask.next >= countTask.target : false;

    await ctx.db.patch(args.roomId, {
      turn: room.turn + 1,
      recentActs,
      loopRisk,
      floorOwner: next,
      done: room.done || (goalUnchanged && args.done) || countDone,
      ...(countCommitted && countTask ? { countNext: Math.min(countTask.next + 1, countTask.target) } : {}),
      // only clear the steer this turn actually consumed — a steer submitted
      // mid-flight survives for the next turn
      ...(room.pendingHuman !== undefined && room.pendingHuman === args.consumedHuman ? { pendingHuman: undefined } : {}),
      updatedAt: Date.now(),
    });

    if (args.speechAct === "backchannel") {
      await insertTrace(ctx, args.roomId, "guardrail_evaluated", "Backchannel — not counted as progress.", { text: args.text });
    }
    await insertTrace(ctx, args.roomId, "state_reduced", `${name} took the floor turn ${room.turn + 1}.`, {
      speechAct: args.speechAct,
      done: (goalUnchanged && args.done) || countDone,
      task: countCommitted ? countTask : null,
    });
    await insertTrace(ctx, args.roomId, "scheduler_selected", `${AGENTS[next].name} owns the next floor.`, { floorOwner: next, loopRisk });
    await boundUtterances(ctx, args.roomId);
    return { committed: true };
  },
});

/** Auto-run hop failed (LLM/TTS error): surface it and stop honestly. */
export const markRunFailed = internalMutation({
  args: { roomId: v.id("rooms"), token: v.number(), error: v.string() },
  handler: async (ctx, args) => {
    const room = await ctx.db.get(args.roomId);
    if (!room || room.runToken !== args.token) return; // a newer run owns the room
    await ctx.db.insert("utterances", {
      roomId: args.roomId,
      slot: "system",
      name: "system",
      text: `turn failed: ${args.error.slice(0, 140)}`,
      speechAct: "error",
      createdAt: Date.now(),
    });
    await ctx.db.patch(args.roomId, { running: false, runToken: room.runToken + 1, updatedAt: Date.now() });
    await insertTrace(ctx, args.roomId, "guardrail_evaluated", "Auto-run halted on error.", { error: args.error.slice(0, 140) });
  },
});

/** After a committed turn, schedule the next hop iff still running (durable loop). */
export const scheduleNext = internalMutation({
  args: { roomId: v.id("rooms"), token: v.number(), delayMs: v.number() },
  handler: async (ctx, args) => {
    const room = await ctx.db.get(args.roomId);
    if (!room) return;
    if (room.running && !room.done && room.runToken === args.token && room.turn < MAX_AUTO_RUN_TURNS) {
      await ctx.scheduler.runAfter(args.delayMs, internal.coordinator.runTurn, { roomId: args.roomId, token: args.token });
    } else if (room.running && (room.done || room.turn >= MAX_AUTO_RUN_TURNS)) {
      await ctx.db.patch(args.roomId, { running: false, updatedAt: Date.now() });
    }
  },
});
