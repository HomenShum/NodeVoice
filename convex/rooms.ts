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
  profileUsesAgentOs,
  normalizeAgentOsPolicy,
  makeRoomCode,
  deriveCountTask,
  goalFromHumanSteeringIntent,
  agentOsGoalKind,
  shouldReplaceAgentOsGoal,
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

function titleForAgentOsIntent(intent: HumanSteeringIntent, goalOverride: string | null, text: string): string | null {
  if (intent.kind === "constraint") return `Constraint: ${intent.note}`;
  if (intent.kind === "question") return `Question: ${intent.question ?? text}`;
  return goalOverride;
}

async function spawnAgentOsGoal(
  ctx: MutationCtx,
  roomId: Id<"rooms">,
  room: {
    goal: string;
    model: string;
    budgetMaxWorkers?: number;
    budgetWorkersUsed?: number;
    permissionWebResearch?: boolean;
    permissionExternalActions?: boolean;
  },
  title: string,
  kind: string,
  sourceText: string,
): Promise<Id<"workers">[]> {
  const now = Date.now();
  const goalId = await ctx.db.insert("goals", {
    roomId,
    title: title.slice(0, 500),
    kind,
    status: "active",
    priority: 1,
    sourceText: sourceText.slice(0, 500),
    createdAt: now,
    updatedAt: now,
  });
  const taskId = await ctx.db.insert("tasks", {
    roomId,
    goalId,
    title: kind === "count" ? "Execute deterministic count task" : "Produce first useful artifact",
    kind: kind === "count" ? "deterministic_execution" : "knowledge_work",
    status: "queued",
    createdAt: now,
    updatedAt: now,
  });

  const workers: Id<"workers">[] = [];
  const blocked: Array<{ kind: string; reason: string }> = [];
  const policy = normalizeAgentOsPolicy(room);
  let workersUsed = policy.budgetWorkersUsed;
  const workerSpecs =
    kind === "count"
      ? [{ kind: "deterministic_count", title: "Prepare exact count sequence", model: undefined as string | undefined }]
      : [
          { kind: "web_research", title: "Research current external context", model: "gpt-4.1-mini" },
          { kind: "execution_plan", title: "Draft execution plan", model: room.model },
        ];
  for (const spec of workerSpecs) {
    const budgetBlocked = workersUsed >= policy.budgetMaxWorkers;
    const permissionBlocked = spec.kind === "web_research" && !policy.permissionWebResearch;
    const blockedReason = budgetBlocked
      ? `Worker budget exhausted (${policy.budgetWorkersUsed}/${policy.budgetMaxWorkers}).`
      : permissionBlocked
        ? "Web research permission is disabled."
        : null;
    const workerId = await ctx.db.insert("workers", {
      roomId,
      goalId,
      taskId,
      kind: spec.kind,
      status: blockedReason ? "blocked" : "queued",
      title: spec.title,
      ...(spec.model ? { model: spec.model } : {}),
      ...(blockedReason ? { error: blockedReason } : {}),
      attempt: 1,
      createdAt: now,
      updatedAt: now,
    });
    workers.push(workerId);
    if (blockedReason) {
      blocked.push({ kind: spec.kind, reason: blockedReason });
    } else {
      workersUsed += 1;
      await ctx.scheduler.runAfter(0, internal.coordinator.runV3Worker, { workerId });
    }
  }
  if (workersUsed !== policy.budgetWorkersUsed) {
    await ctx.db.patch(roomId, { budgetWorkersUsed: workersUsed, updatedAt: now });
  }
  if (blocked.length === workerSpecs.length) {
    await ctx.db.patch(taskId, { status: "blocked", updatedAt: now });
  }
  await ctx.db.insert("beliefs", {
    roomId,
    goalId,
    claim: `User requested workstream: ${title.slice(0, 220)}`,
    source: "human_steer",
    confidence: 1,
    createdAt: now,
    updatedAt: now,
  });
  await insertTrace(ctx, roomId, "worker_scheduled", "V3 goal graph spawned workers.", {
    goalId,
    title,
    kind,
    workers,
    blocked,
    policy: { ...policy, budgetWorkersUsed: workersUsed },
  });
  return workers;
}

async function ensureInitialAgentOsGoal(
  ctx: MutationCtx,
  roomId: Id<"rooms">,
  room: { goal: string; model: string },
): Promise<void> {
  const existing = await ctx.db.query("goals").withIndex("by_room", (q) => q.eq("roomId", roomId)).first();
  if (existing) return;
  await spawnAgentOsGoal(ctx, roomId, room, room.goal, deriveCountTask(room.goal) ? "count" : "planning", "initial_room_goal");
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
  const goals = (await ctx.db.query("goals").withIndex("by_room", (q) => q.eq("roomId", roomId)).order("desc").take(24))
    .reverse()
    .map((g) => ({ id: g._id, title: g.title, kind: g.kind, status: g.status, priority: g.priority, sourceText: g.sourceText, createdAt: g.createdAt, updatedAt: g.updatedAt }));
  const tasks = (await ctx.db.query("tasks").withIndex("by_room", (q) => q.eq("roomId", roomId)).order("desc").take(40))
    .reverse()
    .map((t) => ({ id: t._id, goalId: t.goalId, title: t.title, kind: t.kind, status: t.status, createdAt: t.createdAt, updatedAt: t.updatedAt }));
  const workers = (await ctx.db.query("workers").withIndex("by_room", (q) => q.eq("roomId", roomId)).order("desc").take(50))
    .reverse()
    .map((w) => ({
      id: w._id,
      goalId: w.goalId,
      taskId: w.taskId,
      kind: w.kind,
      status: w.status,
      title: w.title,
      model: w.model,
      summary: w.summary,
      error: w.error,
      createdAt: w.createdAt,
      updatedAt: w.updatedAt,
      startedAt: w.startedAt,
      completedAt: w.completedAt,
    }));
  const artifacts = (await ctx.db.query("artifacts").withIndex("by_room", (q) => q.eq("roomId", roomId)).order("desc").take(24))
    .reverse()
    .map((a) => ({ id: a._id, goalId: a.goalId, workerId: a.workerId, kind: a.kind, title: a.title, content: a.content, sources: a.sources, createdAt: a.createdAt }));
  const beliefs = (await ctx.db.query("beliefs").withIndex("by_room", (q) => q.eq("roomId", roomId)).order("desc").take(40))
    .reverse()
    .map((b) => ({ id: b._id, goalId: b.goalId, claim: b.claim, source: b.source, confidence: b.confidence, createdAt: b.createdAt, updatedAt: b.updatedAt }));
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
    policy: normalizeAgentOsPolicy({
      budgetMaxWorkers: room.budgetMaxWorkers,
      budgetWorkersUsed: room.budgetWorkersUsed,
      permissionWebResearch: room.permissionWebResearch,
      permissionExternalActions: room.permissionExternalActions,
    }),
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
    goals,
    tasks,
    workers,
    artifacts,
    world: { beliefs },
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

export const getV3WorkerRaw = internalQuery({
  args: { workerId: v.id("workers") },
  handler: async (ctx, args) => {
    const worker = await ctx.db.get(args.workerId);
    if (!worker) return null;
    const goal = await ctx.db.get(worker.goalId);
    const task = worker.taskId ? await ctx.db.get(worker.taskId) : null;
    const room = await ctx.db.get(worker.roomId);
    return { worker, goal, task, room };
  },
});

export const insertTraceInternal = internalMutation({
  args: { roomId: v.id("rooms"), kind: v.string(), summary: v.string(), payload: v.any() },
  handler: async (ctx, args) => {
    await insertTrace(ctx, args.roomId, args.kind, args.summary, args.payload);
  },
});

export const startV3Worker = internalMutation({
  args: { workerId: v.id("workers") },
  handler: async (ctx, args) => {
    const worker = await ctx.db.get(args.workerId);
    if (!worker || worker.status !== "queued") return { started: false };
    const now = Date.now();
    await ctx.db.patch(args.workerId, { status: "running", startedAt: now, updatedAt: now });
    if (worker.taskId) await ctx.db.patch(worker.taskId, { status: "running", updatedAt: now });
    await insertTrace(ctx, worker.roomId, "worker_started", `V3 worker started: ${worker.title}.`, { workerId: args.workerId, kind: worker.kind });
    return { started: true };
  },
});

export const completeV3Worker = internalMutation({
  args: {
    workerId: v.id("workers"),
    title: v.string(),
    content: v.string(),
    summary: v.string(),
    sources: v.optional(v.array(v.any())),
    model: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const worker = await ctx.db.get(args.workerId);
    if (!worker) return;
    if (worker.status !== "running") {
      await insertTrace(ctx, worker.roomId, "guardrail_evaluated", "Ignored stale V3 worker completion.", {
        workerId: args.workerId,
        status: worker.status,
      });
      return;
    }
    const now = Date.now();
    await ctx.db.insert("artifacts", {
      roomId: worker.roomId,
      goalId: worker.goalId,
      workerId: args.workerId,
      kind: worker.kind,
      title: args.title.slice(0, 180),
      content: args.content.slice(0, 10000),
      ...(args.sources ? { sources: args.sources } : {}),
      createdAt: now,
    });
    await ctx.db.insert("beliefs", {
      roomId: worker.roomId,
      goalId: worker.goalId,
      claim: args.summary.slice(0, 500),
      source: worker.kind,
      confidence: worker.kind === "web_research" ? 0.82 : 0.72,
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.patch(args.workerId, {
      status: "completed",
      summary: args.summary.slice(0, 500),
      ...(args.model ? { model: args.model } : {}),
      completedAt: now,
      updatedAt: now,
    });
    if (worker.taskId) await ctx.db.patch(worker.taskId, { status: "completed", updatedAt: now });
    await ctx.db.patch(worker.goalId, { status: "active", updatedAt: now });
    await insertTrace(ctx, worker.roomId, "artifact_created", `V3 worker completed: ${worker.title}.`, {
      workerId: args.workerId,
      goalId: worker.goalId,
      kind: worker.kind,
      summary: args.summary,
    });
  },
});

export const failV3Worker = internalMutation({
  args: { workerId: v.id("workers"), error: v.string() },
  handler: async (ctx, args) => {
    const worker = await ctx.db.get(args.workerId);
    if (!worker) return;
    if (worker.status === "canceled" || worker.status === "completed") return;
    const now = Date.now();
    await ctx.db.patch(args.workerId, { status: "failed", error: args.error.slice(0, 500), completedAt: now, updatedAt: now });
    if (worker.taskId) await ctx.db.patch(worker.taskId, { status: "failed", updatedAt: now });
    await insertTrace(ctx, worker.roomId, "worker_failed", `V3 worker failed: ${worker.title}.`, {
      workerId: args.workerId,
      kind: worker.kind,
      error: args.error.slice(0, 500),
    });
  },
});

export const cancelV3Worker = mutation({
  args: { roomId: v.id("rooms"), workerId: v.id("workers") },
  handler: async (ctx, args) => {
    const worker = await ctx.db.get(args.workerId);
    if (!worker || worker.roomId !== args.roomId) throw new Error("worker not found in room");
    if (worker.status === "completed" || worker.status === "failed" || worker.status === "canceled") return;
    const now = Date.now();
    await ctx.db.patch(args.workerId, { status: "canceled", error: "Canceled by user.", completedAt: now, updatedAt: now });
    if (worker.taskId) await ctx.db.patch(worker.taskId, { status: "canceled", updatedAt: now });
    await insertTrace(ctx, args.roomId, "worker_canceled", `V3 worker canceled: ${worker.title}.`, { workerId: args.workerId, kind: worker.kind });
  },
});

export const retryV3Worker = mutation({
  args: { roomId: v.id("rooms"), workerId: v.id("workers") },
  handler: async (ctx, args) => {
    const worker = await ctx.db.get(args.workerId);
    if (!worker || worker.roomId !== args.roomId) throw new Error("worker not found in room");
    if (worker.status === "queued" || worker.status === "running") return { workerId: args.workerId, reused: true };
    const room = await ctx.db.get(args.roomId);
    if (!room) throw new Error("room not found");
    const policy = normalizeAgentOsPolicy({
      budgetMaxWorkers: room.budgetMaxWorkers,
      budgetWorkersUsed: room.budgetWorkersUsed,
      permissionWebResearch: room.permissionWebResearch,
      permissionExternalActions: room.permissionExternalActions,
    });
    const budgetBlocked = policy.budgetWorkersUsed >= policy.budgetMaxWorkers;
    const permissionBlocked = worker.kind === "web_research" && !policy.permissionWebResearch;
    if (budgetBlocked || permissionBlocked) {
      const reason = budgetBlocked
        ? `Worker budget exhausted (${policy.budgetWorkersUsed}/${policy.budgetMaxWorkers}).`
        : "Web research permission is disabled.";
      await insertTrace(ctx, args.roomId, "guardrail_evaluated", "V3 worker retry blocked by policy.", {
        workerId: args.workerId,
        kind: worker.kind,
        reason,
        policy,
      });
      return { workerId: args.workerId, blocked: true, reason };
    }
    const now = Date.now();
    const nextWorkerId = await ctx.db.insert("workers", {
      roomId: args.roomId,
      goalId: worker.goalId,
      ...(worker.taskId ? { taskId: worker.taskId } : {}),
      kind: worker.kind,
      status: "queued",
      title: worker.title,
      ...(worker.model ? { model: worker.model } : {}),
      retryOf: args.workerId,
      attempt: (worker.attempt ?? 1) + 1,
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.patch(args.roomId, { budgetWorkersUsed: policy.budgetWorkersUsed + 1, updatedAt: now });
    if (worker.taskId) await ctx.db.patch(worker.taskId, { status: "queued", updatedAt: now });
    await insertTrace(ctx, args.roomId, "worker_scheduled", `V3 worker retry queued: ${worker.title}.`, {
      workerId: nextWorkerId,
      retryOf: args.workerId,
      kind: worker.kind,
      attempt: (worker.attempt ?? 1) + 1,
    });
    await ctx.scheduler.runAfter(0, internal.coordinator.runV3Worker, { workerId: nextWorkerId });
    return { workerId: nextWorkerId, reused: false };
  },
});

export const setV3Policy = mutation({
  args: {
    roomId: v.id("rooms"),
    budgetMaxWorkers: v.optional(v.number()),
    permissionWebResearch: v.optional(v.boolean()),
    permissionExternalActions: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const room = await ctx.db.get(args.roomId);
    if (!room) throw new Error("room not found");
    const current = normalizeAgentOsPolicy({
      budgetMaxWorkers: room.budgetMaxWorkers,
      budgetWorkersUsed: room.budgetWorkersUsed,
      permissionWebResearch: room.permissionWebResearch,
      permissionExternalActions: room.permissionExternalActions,
    });
    const next = normalizeAgentOsPolicy({
      ...current,
      budgetMaxWorkers: args.budgetMaxWorkers ?? current.budgetMaxWorkers,
      permissionWebResearch: args.permissionWebResearch ?? current.permissionWebResearch,
      permissionExternalActions: args.permissionExternalActions ?? current.permissionExternalActions,
    });
    await ctx.db.patch(args.roomId, {
      budgetMaxWorkers: next.budgetMaxWorkers,
      permissionWebResearch: next.permissionWebResearch,
      permissionExternalActions: next.permissionExternalActions,
      updatedAt: Date.now(),
    });
    await insertTrace(ctx, args.roomId, "policy_updated", "V3 policy updated.", { previous: current, next });
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
      ...normalizeAgentOsPolicy(),
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
    if (profileUsesAgentOs(profile)) {
      await ensureInitialAgentOsGoal(ctx, roomId, { goal, model: validModel(args.model) });
    }
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
    if (profileUsesAgentOs(profile)) {
      await ensureInitialAgentOsGoal(ctx, args.roomId, { goal: room.goal, model: room.model });
    }
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
    const agentOs = profileUsesAgentOs(room.profile);
    const agentOsTitle = agentOs ? titleForAgentOsIntent(intent, goalOverride, args.text) : null;
    const replaceAgentOsForeground = agentOs && shouldReplaceAgentOsGoal(args.text);
    const foregroundGoalOverride = goalOverride && (!agentOs || replaceAgentOsForeground || intent.kind === "count_task") ? goalOverride : null;
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
    let scheduledWorkers = 0;

    if (agentOs && agentOsTitle && intent.kind !== "control" && intent.kind !== "none") {
      const workers = await spawnAgentOsGoal(ctx, args.roomId, room, agentOsTitle, agentOsGoalKind(intent), args.text);
      scheduledWorkers = workers.length;
      stateChanged = true;
    }

    if (foregroundGoalOverride && foregroundGoalOverride !== room.goal) {
      Object.assign(patch, {
        goal: foregroundGoalOverride,
        goalVersion: roomGoalVersion(room) + 1,
        done: false,
        loopRisk: false,
        recentActs: [],
        ...countPatchForGoal(foregroundGoalOverride, room.profile),
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
      (agentOs
        ? intent.kind === "count_task" || (replaceAgentOsForeground && intent.kind === "retarget")
        : intent.kind === "count_task" || intent.kind === "retarget" || intent.kind === "constraint" || intent.kind === "question");
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
      foregroundGoalOverride,
      stateChanged,
      scheduledWorkers,
      profile: roomProfile(room),
    });
    if (foregroundGoalOverride && foregroundGoalOverride !== room.goal) {
      await insertTrace(ctx, args.roomId, "state_reduced", "Human retargeted the room goal.", {
        goal: foregroundGoalOverride,
        source: args.source,
        task: deriveCountTask(foregroundGoalOverride),
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
