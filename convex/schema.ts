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
    // active agent slots are generated as agent-001..agent-N
    agentCount: v.optional(v.number()),
    // capability profile controls which coordination layer the room demonstrates
    profile: v.optional(v.string()),
    // short human-typeable join code (optional: pre-migration rooms lack it)
    code: v.optional(v.string()),
    // private = unlisted from the lobby; joinable only via link/QR/code
    private: v.optional(v.boolean()),
    floorOwner: v.string(),
    turn: v.number(),
    goalVersion: v.optional(v.number()),
    runStartTurn: v.optional(v.number()),
    running: v.boolean(),
    done: v.boolean(),
    loopRisk: v.boolean(),
    recentActs: v.array(v.string()),
    pendingHuman: v.optional(v.string()),
    pendingHumanSeq: v.optional(v.number()),
    countTarget: v.optional(v.number()),
    countNext: v.optional(v.number()),
    // bumped by setRunning to cancel stale scheduler hops (durable auto-run)
    runToken: v.number(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_activity", ["updatedAt"])
    .index("by_code", ["code"]),

  participants: defineTable({
    roomId: v.id("rooms"),
    slot: v.string(),
    kind: v.string(),
    joinedAt: v.number(),
  }).index("by_room", ["roomId"]),

  utterances: defineTable({
    roomId: v.id("rooms"),
    slot: v.string(),
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
