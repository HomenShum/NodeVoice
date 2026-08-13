/**
 * The scenario: someone opens NodeVoice on a laptop, creates a room, and a
 * friend's phone joins it by scanning the code. The two devices must end up in
 * the SAME room, in different seats, seeing the same names — that is the whole
 * claim of the product ("being in the same room physically is not the same as
 * being in the same room computationally").
 *
 * This drives the real HTTP surface (`handleLive`) over a real socket, with no
 * API keys, so it also proves that `src/core/agents.ts` is actually wired into
 * the Node live server rather than merely imported by it.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { handleLive } from "../src/live/roomServer.js";
import { MAX_AGENT_COUNT, activeSlots, agentIdentity, nextSlot } from "../src/core/agents.js";

let server: Server;
let base = "";

beforeAll(async () => {
  server = createServer(async (req, res) => {
    const path = new URL(req.url ?? "/", "http://localhost").pathname;
    if (await handleLive(req, res, path)) return;
    res.writeHead(404).end();
  });
  await new Promise<void>((resolve) => server.listen(0, resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

const post = async (path: string, body: unknown) =>
  (await fetch(base + path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) })).json() as Promise<any>;
const get = async (path: string) => (await fetch(base + path)).json() as Promise<any>;

describe("a laptop creates a room and a phone joins it", () => {
  it("seats both devices in the same room, with the names src/core/agents.ts assigns", async () => {
    const created = await post("/live/rooms", { goal: "count to 10", agentCount: 2 });
    expect(created.ok).toBe(true);

    const roomId: string = created.roomId;
    expect(created.room.agents["agent-001"]).toMatchObject({ name: "Ada", device: "laptop" });
    expect(created.room.agents["agent-002"]).toMatchObject({ name: "Ben", device: "phone" });
    expect(created.room.agents["agent-001"].name).toBe(agentIdentity("agent-001").name);

    // The phone joins by room id and is given the next free seat, not seat 1.
    const joined = await post(`/live/rooms/${roomId}/join`, { kind: "device" });
    expect(joined.ok).toBe(true);
    expect(joined.slot).toBe("agent-001");

    const second = await post(`/live/rooms/${roomId}/join`, { kind: "device" });
    expect(second.slot).toBe("agent-002");
    expect(second.room.id).toBe(roomId); // same room, not merely the same goal

    // Both devices read the same snapshot back.
    const snapshot = await get(`/live/rooms/${roomId}`);
    expect(snapshot.room.state.goal).toContain("10");
    expect(Object.keys(snapshot.room.agents)).toEqual(activeSlots(2));
  });

  it("grows the room to more seats and keeps the turn order rotating", async () => {
    const created = await post("/live/rooms", { goal: "count to 5" });
    const roomId: string = created.roomId;

    const grown = await post(`/live/rooms/${roomId}/agents`, { agentCount: 3 });
    expect(Object.keys(grown.room.agents)).toEqual(["agent-001", "agent-002", "agent-003"]);
    expect(grown.room.agents["agent-003"]).toMatchObject({ name: "Cara", device: "phone" });
    expect(nextSlot("agent-003", 3)).toBe("agent-001");

    // A request for more seats than exist is clamped, never trusted.
    const clamped = await post(`/live/rooms/${roomId}/agents`, { agentCount: 10_000 });
    expect(clamped.room.state.agentCount).toBe(MAX_AGENT_COUNT);
  });

  it("answers 404 for a room id nobody created", async () => {
    expect(await get("/live/rooms/nosuchroom")).toMatchObject({ ok: false, error: "room not found" });
  });
});
