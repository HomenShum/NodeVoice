"use node";
import { v } from "convex/values";
import { internalAction, action } from "./_generated/server";
import { internal, api } from "./_generated/api";
import { agentForSlot, nextSlot, estimateSpeechMs, deriveHumanSteeringIntentFallback, validProfile, type CountTask, type Slot } from "./shared";
import { generateAgentTurn, interpretHumanSteer as interpretHumanSteerWithModel, synthesizeSpeech, transcribeAudio } from "./openai";
import type { Id } from "./_generated/dataModel";

/**
 * Produce one agent turn: LLM → TTS → store audio → commit via mutation.
 * The commit re-validates floor/token server-side (the LLM+TTS work here is
 * seconds long and non-transactional) and reports whether it landed.
 */
async function produceTurn(
  ctx: any,
  roomId: Id<"rooms">,
  room: any,
  token?: number,
): Promise<{ done: boolean; text: string; committed: boolean; reason?: string }> {
  const slot = room.floorOwner as Slot;
  const agent = agentForSlot(slot);
  const snapshot = await ctx.runQuery(api.rooms.watchRoom, { roomId });
  const transcript = (snapshot?.utterances ?? []).map((u: any) => ({ name: u.name, text: u.text }));
  const consumedHuman: string | undefined = room.pendingHuman ?? undefined;
  const countTask: CountTask | null =
    typeof room.countTarget === "number" && typeof room.countNext === "number"
      ? { kind: "count_to_n", target: room.countTarget, next: room.countNext }
      : null;

  const turn = await generateAgentTurn({
    goal: room.goal,
    model: room.model,
    profile: validProfile(room.profile),
    persona: agent.persona,
    selfName: agent.name,
    otherName: agentForSlot(nextSlot(slot, room.agentCount)).name,
    transcript,
    humanNote: consumedHuman,
    recentActs: room.recentActs ?? [],
    countTask,
  });

  let audioId: Id<"_storage"> | undefined;
  try {
    const blob = await synthesizeSpeech(turn.text, agent.openaiVoice);
    audioId = await ctx.storage.store(blob);
  } catch {
    audioId = undefined; // speech is best-effort; the transcript still advances
  }

  const res = await ctx.runMutation(internal.rooms.commitAgentTurn, {
    roomId,
    slot,
    text: turn.text,
    speechAct: turn.speechAct,
    done: turn.done,
    goal: room.goal,
    goalVersion: room.goalVersion ?? 0,
    audioId,
    token,
    consumedHuman,
    countTarget: countTask?.target,
    countNext: countTask?.next,
  });
  return { done: turn.done, text: turn.text, committed: Boolean(res?.committed), reason: res?.reason };
}

/** Durable auto-run hop. Re-checks token/running each time — pause/restart safe. */
export const runTurn = internalAction({
  args: { roomId: v.id("rooms"), token: v.number() },
  handler: async (ctx, args) => {
    const room = await ctx.runQuery(internal.rooms.getRoomRaw, { roomId: args.roomId });
    if (!room || !room.running || room.done || room.runToken !== args.token) return;

    let out: { done: boolean; text: string; committed: boolean; reason?: string };
    try {
      out = await produceTurn(ctx, args.roomId, room, args.token);
    } catch (err) {
      // never leave the room dishonestly stuck on running=true
      await ctx.runMutation(internal.rooms.markRunFailed, {
        roomId: args.roomId,
        token: args.token,
        error: String(err).slice(0, 160),
      });
      return;
    }
    if (!out.committed && out.reason === "lost floor") {
      await ctx.runMutation(internal.rooms.scheduleNext, {
        roomId: args.roomId,
        token: args.token,
        delayMs: 100,
      });
    }
    if (!out.committed) return; // stale hop (paused / superseded) — stop the chain

    // schedule the next hop iff still running (checked inside the mutation)
    await ctx.runMutation(internal.rooms.scheduleNext, {
      roomId: args.roomId,
      token: args.token,
      delayMs: estimateSpeechMs(out.text) + 350,
    });
  },
});

export const interpretHumanSteer = internalAction({
  args: { roomId: v.id("rooms"), text: v.string(), seq: v.number() },
  handler: async (ctx, args) => {
    const room = await ctx.runQuery(internal.rooms.getRoomRaw, { roomId: args.roomId });
    if (!room || room.pendingHuman !== args.text || (room.pendingHumanSeq ?? 0) !== args.seq) return;
    const snapshot = await ctx.runQuery(api.rooms.watchRoom, { roomId: args.roomId });
    const transcript = (snapshot?.utterances ?? []).map((u: any) => ({ name: u.name, text: u.text }));
    let intent;
    let source = "llm";
    try {
      intent = await interpretHumanSteerWithModel({
        text: args.text,
        currentGoal: room.goal,
        model: room.model,
        profile: validProfile(room.profile),
        transcript,
      });
    } catch (err) {
      source = "fallback";
      intent = deriveHumanSteeringIntentFallback(args.text);
      await ctx.runMutation(internal.rooms.insertTraceInternal, {
        roomId: args.roomId,
        kind: "guardrail_evaluated",
        summary: "LLM intent interpreter failed; used deterministic fallback.",
        payload: { error: String(err).slice(0, 160) },
      });
    }
    await ctx.runMutation(internal.rooms.applyHumanIntent, {
      roomId: args.roomId,
      text: args.text,
      seq: args.seq,
      intent,
      source,
    });
  },
});

/**
 * Manual single step. The floor guard in commitAgentTurn makes concurrent
 * double-steps commit at most once.
 */
export const stepOnce = action({
  args: { roomId: v.id("rooms") },
  handler: async (ctx, args) => {
    const room = await ctx.runQuery(internal.rooms.getRoomRaw, { roomId: args.roomId });
    if (!room) throw new Error("room not found");
    if (room.running) return { ok: false, reason: "room is busy" };
    if (room.done) return { ok: false, reason: "room is done" };
    const out = await produceTurn(ctx, args.roomId, room);
    return { ok: out.committed, reason: out.reason };
  },
});

/** Press-to-talk: transcribe recorded audio, then submit as a human steer. */
export const transcribeHuman = action({
  args: { roomId: v.id("rooms"), audioBase64: v.string(), mime: v.string() },
  handler: async (ctx, args) => {
    const bytes = Uint8Array.from(atob(args.audioBase64), (c) => c.charCodeAt(0)).buffer;
    const text = await transcribeAudio(bytes, args.mime);
    if (text) await ctx.runMutation(api.rooms.submitHuman, { roomId: args.roomId, text });
    return { text };
  },
});
