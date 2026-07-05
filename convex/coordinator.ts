"use node";
import { v } from "convex/values";
import { internalAction, action } from "./_generated/server";
import { internal, api } from "./_generated/api";
import { AGENTS, other, estimateSpeechMs, type Slot } from "./shared";
import { generateAgentTurn, synthesizeSpeech, transcribeAudio } from "./openai";
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
): Promise<{ done: boolean; text: string; committed: boolean }> {
  const slot = room.floorOwner as Slot;
  const agent = AGENTS[slot];
  const snapshot = await ctx.runQuery(api.rooms.watchRoom, { roomId });
  const transcript = (snapshot?.utterances ?? []).map((u: any) => ({ name: u.name, text: u.text }));
  const consumedHuman: string | undefined = room.pendingHuman ?? undefined;

  const turn = await generateAgentTurn({
    goal: room.goal,
    model: room.model,
    persona: agent.persona,
    selfName: agent.name,
    otherName: AGENTS[other(slot)].name,
    transcript,
    humanNote: consumedHuman,
    recentActs: room.recentActs ?? [],
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
    audioId,
    token,
    consumedHuman,
  });
  return { done: turn.done, text: turn.text, committed: Boolean(res?.committed) };
}

/** Durable auto-run hop. Re-checks token/running each time — pause/restart safe. */
export const runTurn = internalAction({
  args: { roomId: v.id("rooms"), token: v.number() },
  handler: async (ctx, args) => {
    const room = await ctx.runQuery(internal.rooms.getRoomRaw, { roomId: args.roomId });
    if (!room || !room.running || room.done || room.runToken !== args.token) return;

    let out: { done: boolean; text: string; committed: boolean };
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
    if (!out.committed) return; // stale hop (paused / superseded) — stop the chain

    // schedule the next hop iff still running (checked inside the mutation)
    await ctx.runMutation(internal.rooms.scheduleNext, {
      roomId: args.roomId,
      token: args.token,
      delayMs: estimateSpeechMs(out.text) + 350,
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
    const out = await produceTurn(ctx, args.roomId, room);
    return { ok: out.committed };
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
