import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

/**
 * Convex is the server-authoritative room-state ledger.
 *   query    = reactive read / subscribe
 *   mutation = deterministic state transition (the reducer lives here)
 *   action   = nondeterministic work (LLM / STT / TTS), commits via a mutation
 *
 * The model is never trusted to coordinate — mutations advance the floor and
 * suppress acknowledgement loops. Actions only phrase + voice the turn.
 */
export default defineSchema({
  rooms: defineTable({
    goal: v.string(),
    model: v.string(),
    floorOwner: v.union(v.literal("a"), v.literal("b")),
    turn: v.number(),
    running: v.boolean(),
    done: v.boolean(),
    loopRisk: v.boolean(),
    recentActs: v.array(v.string()),
    pendingHuman: v.optional(v.string()),
    // bumped by setRunning to cancel stale scheduler hops (durable auto-run)
    runToken: v.number(),
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index("by_activity", ["updatedAt"]),

  participants: defineTable({
    roomId: v.id("rooms"),
    slot: v.union(v.literal("a"), v.literal("b"), v.literal("spectator")),
    kind: v.string(),
    joinedAt: v.number(),
  }).index("by_room", ["roomId"]),

  utterances: defineTable({
    roomId: v.id("rooms"),
    slot: v.union(v.literal("a"), v.literal("b"), v.literal("human"), v.literal("system")),
    name: v.string(),
    text: v.string(),
    speechAct: v.string(),
    audioId: v.optional(v.id("_storage")), // TTS mp3 lives in Convex file storage
    createdAt: v.number(),
  }).index("by_room", ["roomId", "createdAt"]),

  // Append-only proof layer. New capabilities = new `kind`s, same one query.
  traces: defineTable({
    roomId: v.id("rooms"),
    kind: v.string(),
    summary: v.string(),
    payload: v.any(),
    createdAt: v.number(),
  }).index("by_room", ["roomId", "createdAt"]),
});
