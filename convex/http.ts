import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";

/**
 * HTTP bridge: mirrors the Node server's /live/* API so the existing frontend
 * works against Convex by only changing its base URL. There is no /events (SSE)
 * route — the client's polling fallback (GET /live/rooms/:id) takes over, which
 * is what we want anyway (Convex + Vercel = permanent URL, laptop can sleep).
 */
const CORS: Record<string, string> = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, POST, OPTIONS",
  "access-control-allow-headers": "content-type",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...CORS } });
const preflight = httpAction(async () => new Response(null, { status: 204, headers: CORS }));

const create = httpAction(async (ctx, req) => {
  const body = (await req.json().catch(() => ({}))) as { goal?: string; model?: string };
  const roomId = await ctx.runMutation(api.rooms.createRoom, { goal: body.goal, model: body.model });
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
      const b = (await req.json().catch(() => ({}))) as { slot?: "a" | "b" | "spectator"; kind?: string };
      const slot = b.slot === "a" || b.slot === "b" ? b.slot : "spectator";
      const participantId = await ctx.runMutation(api.rooms.joinRoom, { roomId: id, slot, kind: b.kind });
      const room = await ctx.runQuery(api.rooms.watchRoom, { roomId: id });
      return json({ ok: true, participantId, slot, room });
    }
    if (sub === "goal") {
      const b = (await req.json().catch(() => ({}))) as { goal?: string };
      if (b.goal) await ctx.runMutation(api.rooms.setGoal, { roomId: id, goal: b.goal });
      return json({ ok: true, room: await ctx.runQuery(api.rooms.watchRoom, { roomId: id }) });
    }
    if (sub === "model") {
      const b = (await req.json().catch(() => ({}))) as { model?: string };
      await ctx.runMutation(api.rooms.setModel, { roomId: id, model: b.model ?? "" });
      return json({ ok: true, room: await ctx.runQuery(api.rooms.watchRoom, { roomId: id }) });
    }
    if (sub === "run") {
      const b = (await req.json().catch(() => ({}))) as { running?: boolean };
      await ctx.runMutation(api.rooms.setRunning, { roomId: id, running: Boolean(b.running) });
      return json({ ok: true, room: await ctx.runQuery(api.rooms.watchRoom, { roomId: id }) });
    }
    if (sub === "step") {
      await ctx.runAction(api.coordinator.stepOnce, { roomId: id });
      return json({ ok: true, room: await ctx.runQuery(api.rooms.watchRoom, { roomId: id }) });
    }
    if (sub === "human") {
      const ct = req.headers.get("content-type") ?? "";
      if (ct.includes("application/json")) {
        const b = (await req.json().catch(() => ({}))) as { text?: string };
        if (b.text) await ctx.runMutation(api.rooms.submitHuman, { roomId: id, text: b.text });
        return json({ ok: true });
      }
      const buf = await req.arrayBuffer();
      let bin = "";
      const bytes = new Uint8Array(buf);
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
http.route({ path: "/live/rooms", method: "POST", handler: create });
http.route({ path: "/live/rooms", method: "OPTIONS", handler: preflight });
http.route({ pathPrefix: "/live/rooms/", method: "GET", handler: roomsGet });
http.route({ pathPrefix: "/live/rooms/", method: "POST", handler: roomsPost });
http.route({ pathPrefix: "/live/rooms/", method: "OPTIONS", handler: preflight });
http.route({ pathPrefix: "/live/audio/", method: "GET", handler: audioGet });
http.route({ pathPrefix: "/live/audio/", method: "OPTIONS", handler: preflight });
export default http;
