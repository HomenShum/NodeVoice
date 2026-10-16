/**
 * SPEC-v3 D1: NodeVoice's write-path normalization of unknown model ids stays. A caller who sends a
 * model id that is not a router row (a typo, a ":free" id, a retired id) gets the room's default model,
 * not an error. Offline: no keys, no provider calls.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { handleLive } from "../src/live/roomServer.js";
import { DEFAULT_LLM_MODEL } from "../src/live/pipeline.js";
import { DEFAULT_MODEL } from "../src/core/routerModels.js";

// convex/*.ts is type-checked by `npm run check:convex`; load by non-literal specifier as the other tests do.
const load = (path: string) => import(/* @vite-ignore */ path);
const rooms = await load("../convex/rooms.ts");

const UNKNOWN = ["not-a-model", "some-model:free", "gpt-4.1-nano", "GPT-5.4-MINI"];

function fakeCtx() {
  const inserted: { table: string; doc: Record<string, any> }[] = [];
  const patches: Record<string, any>[] = [];
  const chain: any = { withIndex: () => chain, order: () => chain, first: async () => null, collect: async () => [], take: async () => [] };
  const ctx = {
    db: {
      query: () => chain,
      get: async () => ({ _id: "room1", turn: 0 }),
      insert: async (table: string, doc: Record<string, any>) => (inserted.push({ table, doc }), `${table}${inserted.length}`),
      patch: async (_id: string, fields: Record<string, any>) => void patches.push(fields),
    },
  };
  return { ctx: ctx as any, inserted, patches };
}

describe("D1: Convex createRoom / setModel normalize an unknown id to DEFAULT_MODEL", () => {
  it.each(UNKNOWN)("%s", async (model) => {
    const create = fakeCtx();
    await rooms.createRoom._handler(create.ctx, { model });
    expect(create.inserted.find((i) => i.table === "rooms")!.doc.model).toBe(DEFAULT_MODEL);
    const set = fakeCtx();
    await rooms.setModel._handler(set.ctx, { roomId: "room1", model });
    expect(set.patches[0]!.model).toBe(DEFAULT_MODEL);
  });
});

describe("D1: the local server normalizes an unknown id to DEFAULT_LLM_MODEL", () => {
  let server: Server;
  let base = "";
  beforeAll(async () => {
    server = createServer(async (req, res) => {
      if (await handleLive(req, res, new URL(req.url ?? "/", "http://localhost").pathname)) return;
      res.writeHead(404).end();
    });
    await new Promise<void>((resolve) => server.listen(0, resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

  const post = async (path: string, body: unknown) => {
    const r = await fetch(base + path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    return { status: r.status, body: (await r.json()) as any };
  };

  it.each(UNKNOWN)("%s", async (model) => {
    const created = await post("/live/rooms", { goal: "count to 3", model });
    expect(created.status).toBe(200);
    expect(created.body.room.state.model).toBe(DEFAULT_LLM_MODEL);
    const set = await post(`/live/rooms/${created.body.roomId}/model`, { model });
    expect(set.status).toBe(200);
    expect(set.body.room.state.model).toBe(DEFAULT_LLM_MODEL);
  });
});
