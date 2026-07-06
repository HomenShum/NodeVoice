import { v } from "convex/values";
import { query, mutation, internalQuery, internalMutation, type QueryCtx, type MutationCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import {
  agentForSlot,
  activeSlots,
  CAPABILITY_PROFILES,
  ROUTER_MODELS,
  DEFAULT_GOAL,
  agentIndexFromSlot,
  isAgentSlot,
  MAX_AGENT_COUNT,
  nextSlot,
  slotForIndex,
  validAgentCount,
  validModel,
  validProfile,
  profileUsesRoomState,
  makeRoomCode,
  deriveCountTask,
  goalFromHumanSteeringIntent,
  type CapabilityProfile,
  type CountTask,
  type HumanSteeringIntent,
  type Slot,
} from "./shared";

const MAX_TRACES = 300;
const MAX_UTTERANCES = 300;
const MAX_AUTO_RUN_TURNS = 320;

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

function roomAgentCount(room: { agentCount?: number }): number {
  return validAgentCount(room.agentCount);
}

function agentPublic(slot: Slot) {
  const a = agentForSlot(slot);
  return { slot: a.slot, name: a.name, device: a.device, persona: a.persona, color: a.color };
}

function publicAgents(agentCount?: number) {
  return Object.fromEntries(activeSlots(agentCount).map((slot) => [slot, agentPublic(slot)]));
}

function roomProfile(room: { profile?: string }): CapabilityProfile {
  return validProfile(room.profile);
}

function profileLabel(profile: CapabilityProfile): string {
  const p = CAPABILITY_PROFILES.find((option) => option.id === profile);
  return p ? `${p.shortLabel} ${p.label}` : profile;
}

function currentCountTask(room: { countTarget?: number; countNext?: number; profile?: string }): CountTask | null {
  if (!profileUsesRoomState(room.profile)) return null;
  if (typeof room.countTarget !== "number" || typeof room.countNext !== "number") return null;
  return { kind: "count_to_n", target: room.countTarget, next: room.countNext };
}

function roomGoalVersion(room: { goalVersion?: number }): number {
  return typeof room.goalVersion === "number" ? room.goalVersion : 0;
}

function countPatchForGoal(goal: string, profile?: string): { countTarget?: number; countNext?: number } {
  if (!profileUsesRoomState(profile)) return { countTarget: undefined, countNext: undefined };
  const task = deriveCountTask(goal);
  return task ? { countTarget: task.target, countNext: task.next } : { countTarget: undefined, countNext: undefined };
}

function joinNotice(slot: string, kind?: string): string {
  if (kind === "creator") return "Room created. Ada joined on this device.";
  if (isAgentSlot(slot)) return `${agentForSlot(slot).name} joined the room.`;
  return "A spectator joined the room.";
}

async function allocateJoinSlot(ctx: MutationCtx, roomId: Id<"rooms">, room: { agentCount?: number }, requested?: string): Promise<Slot | "spectator"> {
  if (requested === "spectator") return "spectator";
  const currentCount = roomAgentCount(room);
  const requestedIndex = requested && isAgentSlot(requested) ? agentIndexFromSlot(requested) : null;
  if (requestedIndex) {
    const nextCount = Math.max(currentCount, requestedIndex);
    if (nextCount !== currentCount) await ctx.db.patch(roomId, { agentCount: nextCount, updatedAt: Date.now() });
    return slotForIndex(requestedIndex);
  }

  const participants = await ctx.db.query("participants").withIndex("by_room", (q) => q.eq("roomId", roomId)).collect();
  const claimed = new Set(participants.map((p) => p.slot).filter(isAgentSlot).map((slot) => slotForIndex(agentIndexFromSlot(slot)!)));
  for (const slot of activeSlots(currentCount)) {
    if (!claimed.has(slot)) return slot;
  }
  if (currentCount >= MAX_AGENT_COUNT) return "spectator";
  const slot = slotForIndex(currentCount + 1);
  await ctx.db.patch(roomId, { agentCount: currentCount + 1, updatedAt: Date.now() });
  return slot;
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
    agents: publicAgents(room.agentCount),
    state: {
      goal: room.goal,
      model: room.model,
      agentCount: roomAgentCount(room),
      profile: roomProfile(room),
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
    profiles: CAPABILITY_PROFILES,
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
      agentCount: roomAgentCount(r),
      profile: roomProfile(r),
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

export const insertTraceInternal = internalMutation({
  args: { roomId: v.id("rooms"), kind: v.string(), summary: v.string(), payload: v.any() },
  handler: async (ctx, args) => {
    await insertTrace(ctx, args.roomId, args.kind, args.summary, args.payload);
  },
});

// ── mutations ─────────────────────────────────────────────────────────
export const createRoom = mutation({
  args: { goal: v.optional(v.string()), model: v.optional(v.string()), private: v.optional(v.boolean()), profile: v.optional(v.string()), agentCount: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const now = Date.now();
    const goal = (args.goal ?? "").trim() || DEFAULT_GOAL;
    const profile = validProfile(args.profile);
    const agentCount = validAgentCount(args.agentCount);
    const countTask = profileUsesRoomState(profile) ? deriveCountTask(goal) : null;
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
      agentCount,
      profile,
      code,
      private: args.private === true,
      floorOwner: slotForIndex(1),
      turn: 0,
      running: false,
      done: false,
      loopRisk: false,
      recentActs: [],
      ...(countTask ? { countTarget: countTask.target, countNext: countTask.next } : {}),
      pendingHumanSeq: 0,
      goalVersion: 0,
      runToken: 0,
      runStartTurn: 0,
      createdAt: now,
      updatedAt: now,
    });
    await insertTrace(ctx, roomId, "state_reduced", "Room created.", { goal, profile, agentCount, task: countTask });
    await ctx.db.insert("utterances", {
      roomId,
      slot: "system",
      name: "system",
      text: `Room created. Share code ${code} or scan the QR to add another device.`,
      speechAct: "system",
      createdAt: now,
    });
    return roomId;
  },
});

export const joinRoom = mutation({
  args: {
    roomId: v.id("rooms"),
    slot: v.optional(v.string()),
    kind: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const room = await ctx.db.get(args.roomId);
    if (!room) throw new Error("room not found");
    const slot = await allocateJoinSlot(ctx, args.roomId, room, args.slot);
    const id = await ctx.db.insert("participants", { roomId: args.roomId, slot, kind: args.kind ?? "device", joinedAt: now });
    await ctx.db.insert("utterances", {
      roomId: args.roomId,
      slot: "system",
      name: "system",
      text: joinNotice(slot, args.kind),
      speechAct: "system",
      createdAt: now,
    });
    await insertTrace(ctx, args.roomId, "state_reduced", "Participant joined the room.", { slot, kind: args.kind ?? "device" });
    await boundUtterances(ctx, args.roomId);
    return { participantId: id, slot };
  },
});

export const setAgentCount = mutation({
  args: { roomId: v.id("rooms"), agentCount: v.number() },
  handler: async (ctx, args) => {
    const room = await ctx.db.get(args.roomId);
    if (!room) throw new Error("room not found");
    const nextCount = validAgentCount(args.agentCount);
    if (nextCount === roomAgentCount(room)) return;
    const floorIndex = agentIndexFromSlot(room.floorOwner) ?? 1;
    const floorOwner = floorIndex > nextCount ? slotForIndex(1) : room.floorOwner;
    await ctx.db.patch(args.roomId, { agentCount: nextCount, floorOwner, updatedAt: Date.now() });
    await insertTrace(ctx, args.roomId, "state_reduced", "Agent roster resized.", { agentCount: nextCount, floorOwner });
    await ctx.db.insert("utterances", {
      roomId: args.roomId,
      slot: "system",
      name: "system",
      text: `Agent roster is now ${nextCount}.`,
      speechAct: "system",
      createdAt: Date.now(),
    });
  },
});

export const setGoal = mutation({
  args: { roomId: v.id("rooms"), goal: v.string() },
  handler: async (ctx, args) => {
    const g = args.goal.trim().slice(0, 400);
    const room = await ctx.db.get(args.roomId);
    if (g && room && g !== room.goal) {
      const countPatch = countPatchForGoal(g, room.profile);
      await ctx.db.patch(args.roomId, {
        goal: g,
        goalVersion: roomGoalVersion(room) + 1,
        done: false,
        loopRisk: false,
        recentActs: [],
        ...countPatch,
        updatedAt: Date.now(),
      });
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

export const setProfile = mutation({
  args: { roomId: v.id("rooms"), profile: v.string() },
  handler: async (ctx, args) => {
    const room = await ctx.db.get(args.roomId);
    if (!room) return;
    const profile = validProfile(args.profile);
    if (profile === roomProfile(room)) return;
    const countPatch = countPatchForGoal(room.goal, profile);
    await ctx.db.patch(args.roomId, {
      profile,
      done: false,
      loopRisk: false,
      recentActs: [],
      goalVersion: roomGoalVersion(room) + 1,
      ...countPatch,
      updatedAt: Date.now(),
    });
    await insertTrace(ctx, args.roomId, "state_reduced", "Capability profile changed.", { profile, task: profileUsesRoomState(profile) ? deriveCountTask(room.goal) : null });
    await ctx.db.insert("utterances", {
      roomId: args.roomId,
      slot: "system",
      name: "system",
      text: `Agent version switched to ${profileLabel(profile)}.`,
      speechAct: "system",
      createdAt: Date.now(),
    });
    await boundUtterances(ctx, args.roomId);
  },
});

export const submitHuman = mutation({
  args: { roomId: v.id("rooms"), text: v.string() },
  handler: async (ctx, args) => {
    const text = args.text.trim().slice(0, 400);
    if (!text) return;
    const room = await ctx.db.get(args.roomId);
    if (!room) return;
    const patch: {
      pendingHuman: string;
      pendingHumanSeq: number;
      updatedAt: number;
    } = { pendingHuman: text, pendingHumanSeq: (room.pendingHumanSeq ?? 0) + 1, updatedAt: Date.now() };
    await ctx.db.insert("utterances", { roomId: args.roomId, slot: "human", name: "you", text, speechAct: "steer", createdAt: Date.now() });
    await ctx.db.patch(args.roomId, patch);
    await insertTrace(ctx, args.roomId, "utterance_received", `you said: ${text}`, {
      text,
      profile: roomProfile(room),
      intentPending: profileUsesRoomState(room.profile),
      pendingHumanSeq: patch.pendingHumanSeq,
    });
    if (profileUsesRoomState(room.profile)) {
      await ctx.scheduler.runAfter(0, internal.coordinator.interpretHumanSteer, {
        roomId: args.roomId,
        text,
        seq: patch.pendingHumanSeq,
      });
    } else {
      await insertTrace(ctx, args.roomId, "intent_interpreted", "V0 profile left human steer as raw transcript context.", {
        text,
        source: "profile",
        intent: { kind: "none", reason: "v0_no_room_state does not mutate durable room state" },
      });
    }
    await boundUtterances(ctx, args.roomId);
  },
});

export const applyHumanIntent = internalMutation({
  args: { roomId: v.id("rooms"), text: v.string(), seq: v.number(), intent: v.any(), source: v.string() },
  handler: async (ctx, args) => {
    const room = await ctx.db.get(args.roomId);
    if (!room) return { applied: false, reason: "room missing" };
    if ((room.pendingHumanSeq ?? 0) !== args.seq || room.pendingHuman !== args.text) {
      await insertTrace(ctx, args.roomId, "guardrail_evaluated", "Ignored stale human-intent interpretation.", {
        source: args.source,
        seq: args.seq,
        currentSeq: room.pendingHumanSeq ?? 0,
      });
      return { applied: false, reason: "stale human steer" };
    }

    const intent = args.intent as HumanSteeringIntent;
    const goalOverride = goalFromHumanSteeringIntent(intent);
    const patch: {
      goal?: string;
      goalVersion?: number;
      done?: boolean;
      loopRisk?: boolean;
      recentActs?: string[];
      countTarget?: number;
      countNext?: number;
      running?: boolean;
      runToken?: number;
      runStartTurn?: number;
      updatedAt: number;
    } = { updatedAt: Date.now() };
    let resumeToken: number | null = null;
    let stateChanged = false;

    if (goalOverride && goalOverride !== room.goal) {
      Object.assign(patch, {
        goal: goalOverride,
        goalVersion: roomGoalVersion(room) + 1,
        done: false,
        loopRisk: false,
        recentActs: [],
        ...countPatchForGoal(goalOverride, room.profile),
      });
      stateChanged = true;
    }

    if (intent.kind === "count_task" && goalOverride && goalOverride === room.goal && (room.done || currentCountTask(room) === null)) {
      Object.assign(patch, {
        done: false,
        loopRisk: false,
        recentActs: [],
        ...countPatchForGoal(goalOverride, room.profile),
      });
      stateChanged = true;
    }

    if (intent.kind === "control") {
      if ((intent.action === "pause" || intent.action === "stop") && room.running) {
        Object.assign(patch, { running: false, runToken: room.runToken + 1 });
        stateChanged = true;
      }
      if ((intent.action === "start" || intent.action === "resume") && !room.running) {
        resumeToken = room.runToken + 1;
        Object.assign(patch, {
          done: false,
          loopRisk: false,
          recentActs: [],
          running: true,
          runToken: resumeToken,
          runStartTurn: room.turn,
        });
        stateChanged = true;
      }
    }

    const shouldResumeForIntent =
      !room.running &&
      resumeToken === null &&
      (intent.kind === "count_task" || intent.kind === "retarget" || intent.kind === "constraint" || intent.kind === "question");
    if (shouldResumeForIntent) {
      resumeToken = room.runToken + 1;
      Object.assign(patch, {
        done: false,
        loopRisk: false,
        recentActs: [],
        running: true,
        runToken: resumeToken,
        runStartTurn: room.turn,
      });
      stateChanged = true;
    }

    if (stateChanged) await ctx.db.patch(args.roomId, patch);
    await insertTrace(ctx, args.roomId, "intent_interpreted", `Human steer interpreted as ${intent.kind}.`, {
      source: args.source,
      intent,
      goalOverride,
      stateChanged,
      profile: roomProfile(room),
    });
    if (goalOverride && goalOverride !== room.goal) {
      await insertTrace(ctx, args.roomId, "state_reduced", "Human retargeted the room goal.", {
        goal: goalOverride,
        source: args.source,
        task: deriveCountTask(goalOverride),
      });
    }
    if (resumeToken !== null) {
      await insertTrace(ctx, args.roomId, "scheduler_selected", "Auto-run resumed by human intent.", { floorOwner: room.floorOwner, intent: intent.kind });
      await ctx.scheduler.runAfter(0, internal.coordinator.runTurn, { roomId: args.roomId, token: resumeToken });
    }
    return { applied: true, stateChanged };
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
      if (room.running || room.done) return;
      const token = room.runToken + 1;
      await ctx.db.patch(args.roomId, { running: true, runToken: token, runStartTurn: room.turn, updatedAt: Date.now() });
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
    slot: v.string(),
    text: v.string(),
    speechAct: v.string(),
    done: v.boolean(),
    goal: v.string(),
    goalVersion: v.optional(v.number()),
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
    if (room.done) {
      if (args.audioId) {
        try {
          await ctx.storage.delete(args.audioId);
        } catch {
          /* ignore */
        }
      }
      return { committed: false, reason: "done" };
    }
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
    const slot = args.slot as Slot;
    const name = agentForSlot(slot).name;

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
    const next = nextSlot(slot, room.agentCount);
    const goalUnchanged = room.goal === args.goal && roomGoalVersion(room) === (args.goalVersion ?? 0);
    const countTask = currentCountTask(room);
    const countCommitted =
      goalUnchanged && countTask !== null && args.countTarget === countTask.target && args.countNext === countTask.next;
    const countDone = countCommitted && countTask ? countTask.next >= countTask.target : false;
    const effectiveDone = countTask ? countDone : goalUnchanged && args.done;

    await ctx.db.patch(args.roomId, {
      turn: room.turn + 1,
      recentActs,
      loopRisk,
      floorOwner: next,
      done: effectiveDone,
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
      done: effectiveDone,
      task: countCommitted ? countTask : null,
    });
    await insertTrace(ctx, args.roomId, "scheduler_selected", `${agentForSlot(next).name} owns the next floor.`, { floorOwner: next, loopRisk });
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
    const runStartTurn = typeof room.runStartTurn === "number" ? room.runStartTurn : room.turn;
    const runTurns = room.turn - runStartTurn;
    if (room.running && !room.done && room.runToken === args.token && runTurns < MAX_AUTO_RUN_TURNS) {
      await ctx.scheduler.runAfter(args.delayMs, internal.coordinator.runTurn, { roomId: args.roomId, token: args.token });
    } else if (room.running && room.runToken === args.token && runTurns >= MAX_AUTO_RUN_TURNS && !room.done) {
      await ctx.db.insert("utterances", {
        roomId: args.roomId,
        slot: "system",
        name: "system",
        text: `Auto-run paused after ${MAX_AUTO_RUN_TURNS} turns in this run. Press Start to continue.`,
        speechAct: "system",
        createdAt: Date.now(),
      });
      await insertTrace(ctx, args.roomId, "guardrail_evaluated", "Auto-run paused at the per-run turn cap.", { maxRunTurns: MAX_AUTO_RUN_TURNS });
      await ctx.db.patch(args.roomId, { running: false, updatedAt: Date.now() });
    } else if (room.running && room.done) {
      await ctx.db.patch(args.roomId, { running: false, updatedAt: Date.now() });
    }
  },
});
