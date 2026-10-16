/**
 * The scenario: a client (the UI, a script, or someone holding the public Convex URL) asks for a room
 * on a model. A request for a free-looking or unknown id must be refused, never silently stored as the
 * paid DEFAULT_MODEL (which every later coordinator turn would then bill). Absent or empty means
 * "no preference" and keeps the default. Stored stale ids keep falling back on read (validModel);
 * that is covered in roomModelMigration.test.ts. Offline: no keys, no provider calls.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { handleLive } from "../src/live/roomServer.js";
import { DEFAULT_MODEL, ROUTER_MODELS } from "../src/core/routerModels.js";

// convex/*.ts is type-checked by `npm run check:convex`; load by non-literal specifier as the other tests do.
const load = (path: string) => import(/* @vite-ignore */ path);
const rooms = await load("../convex/rooms.ts");
const http = (await load("../convex/http.ts")).default;

// Only undefined and "" mean "no preference". Falsy and non-string JSON values are refusals too: `0`, `false`
// and `null` used to take the fallback branch, and `123`, `{}` and `true` made the error constructor itself throw.
const REFUSED: unknown[] = [
  "some-model:free", "nvidia/nemotron-3-super-120b-a12b:free", "not-a-model", "gpt-4.1-nano", "GPT-5.4-MINI", " gpt-5.4-mini",
  0, false, null, 123, {}, true,
];
const ROUTER_IDS = ROUTER_MODELS.map((m) => m.id);

/** Records every write; the room row it inserts is what later coordinator turns read `model` from. */
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

describe("Convex public boundary: createRoom / setModel", () => {
  it.each(REFUSED)("createRoom throws on %j and writes nothing", async (model) => {
    const { ctx, inserted } = fakeCtx();
    await expect(rooms.createRoom._handler(ctx, { model })).rejects.toThrow(/unknown model id/);
    expect(inserted).toEqual([]);
  });

  it.each(REFUSED)("setModel throws on %j and patches nothing", async (model) => {
    const { ctx, patches } = fakeCtx();
    await expect(rooms.setModel._handler(ctx, { roomId: "room1", model })).rejects.toThrow(/unknown model id/);
    expect(patches).toEqual([]);
  });

  it("absent or empty keeps DEFAULT_MODEL (the UI passes undefined to createRoom; http.ts sends \"\" to setModel)", async () => {
    for (const model of [undefined, ""]) {
      const create = fakeCtx();
      await rooms.createRoom._handler(create.ctx, { model });
      expect(create.inserted.find((i) => i.table === "rooms")!.doc.model).toBe(DEFAULT_MODEL);
      const set = fakeCtx();
      await rooms.setModel._handler(set.ctx, { roomId: "room1", model: model ?? "" });
      expect(set.patches[0]!.model).toBe(DEFAULT_MODEL);
    }
  });

  it("every router id is stored exactly as asked", async () => {
    for (const model of ROUTER_IDS) {
      const create = fakeCtx();
      await rooms.createRoom._handler(create.ctx, { model });
      expect(create.inserted.find((i) => i.table === "rooms")!.doc.model).toBe(model);
      const set = fakeCtx();
      await rooms.setModel._handler(set.ctx, { roomId: "room1", model });
      expect(set.patches[0]!.model).toBe(model);
    }
  });
});

describe("local Node server boundary: POST /live/rooms and POST /live/rooms/:id/model", () => {
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

  it.each(REFUSED)("refuses %j with 400 at both routes and leaves the room's model untouched", async (model) => {
    const refused = await post("/live/rooms", { goal: "count to 3", model });
    expect(refused.status).toBe(400);
    expect(refused.body.ok).toBe(false);
    expect(refused.body.roomId).toBeUndefined();

    const created = await post("/live/rooms", { goal: "count to 3", model: "gpt-4.1-mini" });
    expect(created.body.room.state.model).toBe("gpt-4.1-mini");
    const change = await post(`/live/rooms/${created.body.roomId}/model`, { model });
    expect(change.status).toBe(400);
    expect(change.body.ok).toBe(false);
    const after = await (await fetch(`${base}/live/rooms/${created.body.roomId}`)).json() as any;
    expect(after.room.state.model).toBe("gpt-4.1-mini");
  });

  it("absent or empty model keeps the default; a router id is honoured", async () => {
    const a = await post("/live/rooms", { goal: "count to 3" });
    const b = await post("/live/rooms", { goal: "count to 3", model: "" });
    expect(a.status).toBe(200);
    expect(b.status).toBe(200);
    expect(a.body.room.state.model).toBe(b.body.room.state.model);
    const set = await post(`/live/rooms/${a.body.roomId}/model`, { model: "gpt-5-mini" });
    expect(set.body.room.state.model).toBe("gpt-5-mini");
    const reset = await post(`/live/rooms/${a.body.roomId}/model`, { model: "" });
    expect(reset.status).toBe(200);
    expect(reset.body.room.state.model).toBe(b.body.room.state.model);
  });
});

describe("hosted Convex HTTP routes: POST /live/rooms and POST /live/rooms/:id/model", () => {
  /** Runs the registered httpAction with a recording ctx; `mutations` is every write it attempted. */
  async function call(path: string, body: unknown) {
    const mutations: Record<string, any>[] = [];
    const ctx = { runMutation: async (_fn: unknown, args: Record<string, any>) => (mutations.push(args), "room1"), runQuery: async () => ({ state: {} }) };
    const [handler] = http.lookup(path, "POST");
    const res: Response = await handler._handler(ctx, new Request("http://convex.test" + path, { method: "POST", body: JSON.stringify(body) }));
    return { res, mutations, body: (await res.json()) as any };
  }

  it.each(REFUSED)("refuses %j with 400 and CORS headers at both routes, and writes nothing", async (model) => {
    for (const path of ["/live/rooms", "/live/rooms/room1/model"]) {
      const { res, mutations, body } = await call(path, { goal: "count to 3", model });
      expect(res.status).toBe(400);
      expect(res.headers.get("access-control-allow-origin")).toBe("*");
      expect(body.ok).toBe(false);
      expect(body.error).toMatch(/unknown model id/);
      expect(mutations).toEqual([]);
    }
  });

  it("absent or empty model reaches the mutation as the default; a router id is passed exactly as asked", async () => {
    for (const path of ["/live/rooms", "/live/rooms/room1/model"]) {
      for (const [sent, stored] of [[undefined, DEFAULT_MODEL], ["", DEFAULT_MODEL], ["gpt-5-mini", "gpt-5-mini"]] as const) {
        const { res, mutations } = await call(path, { model: sent });
        expect(res.status).toBe(200);
        expect(mutations).toHaveLength(1);
        expect(mutations[0]!.model).toBe(stored);
      }
    }
  });
});
