import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_MODEL, ROUTER_MODELS, ROUTER_PRICING_AS_OF, validModel } from "../src/core/routerModels.js";

// convex/*.ts are type-checked by `npm run check:convex` (Convex module settings); the root
// `tsc` cannot compile them, so they are loaded by a non-literal specifier, as the app
// bundler does. Everything the tests call on them is asserted at runtime.
const load = (path: string) => import(/* @vite-ignore */ path);
const rooms = await load("../convex/rooms.ts");
const coordinator = await load("../convex/coordinator.ts");
const liveRoom = await load("../src/client/live/LiveRoom.tsx");

// OpenAI retires gpt-4.1-nano on 2026-10-23 (platform.openai.com deprecations page).
// A host who created a room before the row was removed still has it stored on `rooms.model`;
// `validModel` only runs on writes, so the coordinator used to send the dead id to OpenAI.
// Fixture of the PRE-CHANGE validator: the id list as it was before the row was removed.
const PRE_CHANGE_IDS = ["gpt-5.4-mini", "gpt-4.1-nano", "gpt-4.1-mini", "gpt-4o-mini", "gpt-5-nano", "gpt-5-mini"];
const preChangeValidModel = (m?: string) => (m && PRE_CHANGE_IDS.includes(m) ? m : "gpt-5.4-mini");

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

type Row = Record<string, any>;
const MIB = 1024 * 1024;
/** In-memory stand-in for a Convex MutationCtx: just the db calls the migration makes. */
function fakeMutationCtx(roomRows: Row[], workerRows: Row[] = []) {
  const patches: { id: string; fields: Row }[] = [];
  const inserted: { table: string; doc: Row }[] = [];
  // Convex's per-mutation limits (docs.convex.dev/production/state/limits): 16 MiB read, 8 MiB written.
  // A row's `bytes` is its document size; paginate reads it, patch re-reads and rewrites it.
  const txn = { read: 0, written: 0 };
  const spend = (kind: "read" | "written", n: number, max: number) => {
    txn[kind] += n;
    if (txn[kind] > max) throw new Error(`Transaction exceeded ${kind} limit: ${txn[kind]} > ${max}`);
  };
  const ctx = {
    txn,
    db: {
      query: (table: string) => ({
        paginate: async ({ numItems, cursor }: { numItems: number; cursor: string | null }) => {
          const rows = table === "rooms" ? roomRows : table === "workers" ? workerRows : null;
          expect(rows, `unexpected table ${table}`).not.toBeNull();
          const start = cursor ? Number(cursor) : 0;
          const page = rows!.slice(start, start + numItems);
          for (const r of page) spend("read", r.bytes ?? 0, 16 * MIB);
          const end = start + page.length;
          return { page, isDone: end >= rows!.length, continueCursor: String(end) };
        },
      }),
      patch: async (id: string, fields: Row) => {
        const row = [...roomRows, ...workerRows].find((r) => r._id === id)!;
        spend("read", row.bytes ?? 0, 16 * MIB);
        spend("written", row.bytes ?? 0, 8 * MIB);
        patches.push({ id, fields });
        Object.assign(row, fields);
      },
      insert: async (table: string, doc: Row) => void inserted.push({ table, doc }),
    },
  };
  return { ctx: ctx as any, patches, inserted, txn };
}

describe("retired router model: gpt-4.1-nano", () => {
  it("was a selectable id before the change and is not now", () => {
    expect(preChangeValidModel("gpt-4.1-nano")).toBe("gpt-4.1-nano"); // the stale value is reachable
    expect(ROUTER_MODELS.map((m) => m.id)).not.toContain("gpt-4.1-nano");
    expect(validModel("gpt-4.1-nano")).toBe(DEFAULT_MODEL);
    expect(ROUTER_MODELS).toHaveLength(5);
  });

  it("the picker options a host chooses from carry the retirement date for the gpt-5 rows only", () => {
    // render the real <ModelSelect>; its <option> text is what the host sees in the dropdown
    const rm = { room: { models: ROUTER_MODELS, state: { model: DEFAULT_MODEL } }, setModel: () => {} };
    const html = renderToStaticMarkup(createElement(liveRoom.ModelSelect, { rm }));
    const options = new Map([...html.matchAll(/<option value="([^"]+)"[^>]*>([^<]*)<\/option>/g)].map((m) => [m[1]!, m[2]!]));
    expect([...options.keys()]).toEqual(ROUTER_MODELS.map((m) => m.id));
    for (const id of ["gpt-5-nano", "gpt-5-mini"]) expect(options.get(id), id).toContain("retires 2026-12-11");
    for (const id of ["gpt-5.4-mini", "gpt-4.1-mini", "gpt-4o-mini"]) expect(options.get(id), id).not.toContain("retires");
  });

  it("migrateRetiredRoomModels rewrites stale rooms to DEFAULT_MODEL, records them, and leaves valid rooms alone", async () => {
    const roomRows: Row[] = [
      { _id: "r1", model: "gpt-4.1-nano" },
      { _id: "r2", model: "gpt-5.4-mini" },
      { _id: "r3", model: "gpt-4.1-mini" },
      { _id: "r4", model: "gpt-4.1-nano" },
    ];
    const { ctx, patches, inserted } = fakeMutationCtx(roomRows);
    const out = await rooms.retireRoomModels(ctx, null);
    expect(out).toMatchObject({ migrated: 2, isDone: true });
    expect(patches).toEqual([
      { id: "r1", fields: { model: DEFAULT_MODEL } },
      { id: "r4", fields: { model: DEFAULT_MODEL } },
    ]);
    expect(inserted.map((i) => i.table)).toEqual(["roomModelMigrations", "roomModelMigrations"]);
    expect(inserted[0]!.doc).toMatchObject({ roomId: "r1", from: "gpt-4.1-nano", to: DEFAULT_MODEL });
    expect(typeof inserted[0]!.doc.at).toBe("number");
    // idempotent: a repeated run finds nothing to do
    const again = await rooms.retireRoomModels(ctx, null);
    expect(again.migrated).toBe(0);
  });

  it("every migration page stays inside Convex's per-mutation byte limits even when every goal is ~1 MiB (the page stops and the cursor continues)", async () => {
    // `createRoom` stores `goal` with no length cap, so a stale room can be a full 1 MiB document.
    const mk = (n: number, make: (i: number) => Row) => Array.from({ length: n }, (_, i) => make(i));
    const roomRows = mk(40, (i) => ({ _id: `r${i}`, model: "gpt-4.1-nano", bytes: MIB }));
    const workerRows = mk(40, (i) => ({ _id: `w${i}`, roomId: "r0", kind: "execution_plan", model: "gpt-4.1-nano", bytes: MIB }));
    const { ctx, txn } = fakeMutationCtx(roomRows, workerRows);

    // the failure this bound prevents: a 200-row page of 1 MiB documents blows the read limit, and re-running the same cursor would fail again
    await expect(ctx.db.query("rooms").paginate({ numItems: 200, cursor: null })).rejects.toThrow(/read limit/);

    for (const [table, retire] of [["rooms", rooms.retireRoomModels], ["workers", rooms.retireWorkerModels]] as const) {
      let cursor: string | null = null;
      let migrated = 0;
      let pages = 0;
      for (;;) {
        txn.read = txn.written = 0; // a fresh transaction per call
        const out: { migrated: number; isDone: boolean; continueCursor: string } = await retire(ctx, cursor); // throws if the page exceeded 16 MiB read / 8 MiB written
        expect(out.migrated, `${table} page ${pages}`).toBeLessThanOrEqual(rooms.MIGRATION_PAGE_SIZE);
        migrated += out.migrated;
        pages += 1;
        if (out.isDone) break;
        cursor = out.continueCursor; // the page stopped; the next call continues from here
      }
      expect(migrated, table).toBe(40);
      expect(pages, table).toBeGreaterThan(1);
    }
    expect(roomRows.every((r) => r.model === DEFAULT_MODEL)).toBe(true);
    expect(workerRows.every((r) => r.model === DEFAULT_MODEL)).toBe(true);
  });

  it("the page-size bound is derived from the Convex limits: pageSize x 1 MiB x 2 reads < 16 MiB and pageSize x 1 MiB writes < 8 MiB", () => {
    expect(rooms.MIGRATION_PAGE_SIZE * MIB * 2).toBeLessThan(16 * MIB);
    expect(rooms.MIGRATION_PAGE_SIZE * MIB).toBeLessThan(8 * MIB);
  });

  it("scripts/migrate-retired-models.mjs walks every page of a table, follows the cursor and sums the rewrites (a second run reports 0)", async () => {
    const script = await load("../scripts/migrate-retired-models.mjs");
    const roomRows: Row[] = Array.from({ length: 14 }, (_, i) => ({ _id: `r${i}`, model: i % 2 ? "gpt-4.1-nano" : "gpt-5.4-mini" }));
    const { ctx } = fakeMutationCtx(roomRows);
    const calls: unknown[] = [];
    // stand-in for `npx convex run --prod`: same arguments, same result shape, JSON round trip
    const run = async (args: { table: string; cursor: string | null }) => {
      calls.push(args);
      return JSON.parse(JSON.stringify(await rooms.migrateRetiredRoomModels._handler(ctx, args)));
    };
    const first = await script.migrateTable(run, "rooms");
    expect(first).toEqual({ table: "rooms", migrated: 7, pages: Math.ceil(14 / rooms.MIGRATION_PAGE_SIZE) });
    expect(calls).toHaveLength(first.pages);
    expect(calls[0]).toEqual({ table: "rooms", cursor: null });
    expect(calls[1]).toMatchObject({ table: "rooms", cursor: expect.any(String) });
    expect((await script.migrateTable(run, "rooms")).migrated).toBe(0);
    // convex run prints function logs before the strict-JSON result
    expect(script.parseRunOutput(["some log line", "{ not json } mid-log", "{", '  "migrated": 2,', '  "isDone": true,', '  "continueCursor": "c"', "}", ""].join("\n"))).toEqual({ migrated: 2, isDone: true, continueCursor: "c" });
  });

  /** Run the coordinator's real turn for `room` against a fake OpenAI transport; return the bodies it sent. */
  async function turnRequestBodies(room: Row) {
    vi.stubEnv("OPENAI_API_KEY", "test-key");
    const bodies: { url: string; body: Record<string, unknown> }[] = [];
    vi.stubGlobal("fetch", async (url: string | URL, init?: RequestInit) => {
      const u = String(url);
      bodies.push({ url: u, body: JSON.parse(String(init?.body)) });
      if (u.endsWith("/chat/completions")) {
        return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ text: "Let's begin.", speechAct: "task_action", done: false }) } }] }), { status: 200 });
      }
      return new Response("no tts in test", { status: 500 }); // speech is best-effort
    });
    const ctx = { runQuery: vi.fn(async () => ({ utterances: [] })), runMutation: vi.fn(async () => ({ committed: true })) } as any;
    const out = await coordinator.produceTurn(ctx, "room1" as any, room, 1);
    expect(out.committed).toBe(true);
    return bodies;
  }
  const baseRoom = { goal: "Plan a launch", floorOwner: "agent-001", agentCount: 2, goalVersion: 0, recentActs: [] };

  it("the coordinator's next turn for a stale room requests gpt-5.4-mini in the gpt-5 request shape", async () => {
    const bodies = await turnRequestBodies({ ...baseRoom, model: "gpt-4.1-nano" });
    const chat = bodies.find((b) => b.url.endsWith("/chat/completions"))!;
    expect(chat.body.model).toBe("gpt-5.4-mini");
    // gpt-5.x shape: the 4.x-only keys must be absent
    expect(chat.body).not.toHaveProperty("temperature");
    expect(chat.body).not.toHaveProperty("max_tokens");
    expect(chat.body.max_completion_tokens).toBe(1500);
    expect(chat.body.reasoning_effort).toBe("low");
    expect(bodies.some((b) => b.body.model === "gpt-4.1-nano")).toBe(false);
  });

  it("one room, end to end: created with the pre-change validator, migrated, audited, then its next turn requests gpt-5.4-mini", async () => {
    // created through the PRE-CHANGE validator: nano was a valid pick for the host
    const room: Row = { _id: "r1", ...baseRoom, model: preChangeValidModel("gpt-4.1-nano") };
    expect(room.model).toBe("gpt-4.1-nano");
    const { ctx, inserted } = fakeMutationCtx([room]);
    await rooms.retireRoomModels(ctx, null);
    expect(room.model).toBe(DEFAULT_MODEL);
    expect(inserted).toHaveLength(1);
    expect(inserted[0]!.doc).toMatchObject({ roomId: "r1", from: "gpt-4.1-nano", to: DEFAULT_MODEL });
    const bodies = await turnRequestBodies(room);
    expect(bodies.find((b) => b.url.endsWith("/chat/completions"))!.body.model).toBe("gpt-5.4-mini");
  });

  it("a web-research worker keeps its stored model, even one outside the picker (caller argument preserved)", async () => {
    // completeV3Worker stores the resolved model (e.g. an OPENAI_WEB_MODEL override); retryV3Worker copies it.
    vi.stubEnv("OPENAI_API_KEY", "test-key");
    const bodies: Record<string, unknown>[] = [];
    vi.stubGlobal("fetch", async (_u: string | URL, init?: RequestInit) => {
      bodies.push(JSON.parse(String(init?.body)));
      return new Response("stop", { status: 500 }); // only the request model matters here
    });
    const worker = { kind: "web_research", title: "Research", model: "gpt-5.4" };
    const runQuery = vi.fn(async () => ({ worker, goal: { title: "Goal" }, room: { goal: "Plan", model: "gpt-4.1-nano" } }));
    const runMutation = vi.fn(async (_ref: unknown, a: Record<string, unknown>) => ("workerId" in a && !("error" in a) && !("content" in a) ? { started: true } : undefined));
    await coordinator.runV3Worker._handler({ runQuery, runMutation } as any, { workerId: "w1" });
    expect(bodies[0]!.model).toBe("gpt-5.4");
  });

  it("router prices agree with the eval script's per-M table and the recorded run, and carry one as-of date (SPEC A.0.6)", async () => {
    // scripts/model-eval.mjs needs a key and spends money on import, so read it as text.
    const { readFile } = await import("node:fs/promises");
    const src = await readFile(new URL("../scripts/model-eval.mjs", import.meta.url), "utf8");
    const table = new Map(
      [...src.matchAll(/\{ id: "([^"]+)", nextgen: (?:true|false), price: \[([\d.]+), ([\d.]+)\] \}/g)].map((m) => [m[1]!, [Number(m[2]), Number(m[3])] as const]),
    );
    expect([...table.keys()].sort()).toEqual(ROUTER_MODELS.map((m) => m.id).sort()); // the eval never prices a retired id or omits a live one
    const asOf = src.match(/const PRICING_AS_OF = "(\d{4}-\d{2}-\d{2})";/)![1];

    const results = JSON.parse(await readFile(new URL("../docs/model-eval-results.json", import.meta.url), "utf8"));
    const close = (a: number, b: number, what: string) => expect(Math.abs(a - b), what).toBeLessThanOrEqual(1e-9 * Math.max(Math.abs(a), Math.abs(b)));
    for (const { id } of ROUTER_MODELS) {
      const [inPerM, outPerM] = table.get(id)!;
      const rows = results.detail.filter((r: Row) => r.model === id);
      expect(rows.length, `recorded calls for ${id}`).toBeGreaterThan(0);
      for (const r of rows) close((r.promptTokens * inPerM + r.completionTokens * outPerM) / 1e6, r.costPerTurn, `${id} ${r.scenario} cost recomputed from the price table`);
      const avg = rows.reduce((t: number, r: Row) => t + r.costPerTurn, 0) / rows.length;
      const recorded = results.byModel.find((m: Row) => m.model === id).costPerTurn;
      close(avg, recorded, `${id} byModel.costPerTurn`);
      close(ROUTER_MODELS.find((m) => m.id === id)!.expectedCostUsd, recorded, `${id} ROUTER_MODELS.expectedCostUsd`);
    }
    // the routerModels numbers, the eval table and the recorded run were all priced on the same day
    expect(ROUTER_PRICING_AS_OF).toBe(asOf);
    expect(results.ranAt.slice(0, 10)).toBe(asOf);
  });

  it("the README $/turn table and the chart's DATA rows show the recorded per-turn cost at display precision (SPEC A.0.6)", async () => {
    // Both files are frozen docs-loop surfaces: read-only here. Every displayed figure must equal
    // byModel.costPerTurn at the 2 significant figures the docs print.
    const { readFile } = await import("node:fs/promises");
    const results = JSON.parse(await readFile(new URL("../docs/model-eval-results.json", import.meta.url), "utf8"));
    const recorded = new Map<string, number>(results.byModel.map((m: Row) => [m.model, m.costPerTurn]));
    const readme = await readFile(new URL("../README.md", import.meta.url), "utf8");
    const table = readme.slice(readme.indexOf("| Model | Proofloop quality")).split("\n\n")[0]!;
    const readmeRows = table.split("\n").map((l) => l.split("|").map((c) => c.replace(/\*/g, "").trim())).filter((c) => c[1]?.startsWith("gpt-"));
    const readmeCosts = new Map<string, number>(readmeRows.map((c) => [c[1]!.split(" ")[0]!, Number(c[4]!.replace("$", ""))]));
    const chart = await readFile(new URL("../scripts/generate-chart.mjs", import.meta.url), "utf8");
    const chartCosts = new Map<string, number>([...chart.matchAll(/\["(gpt-[^"]+)", [\d.]+, [\d.]+, ([\d.]+),/g)].map((m) => [m[1]!, Number(m[2])]));
    for (const [where, shown] of [["README.md", readmeCosts], ["scripts/generate-chart.mjs", chartCosts]] as const) {
      expect([...shown.keys()].sort(), `${where} model ids`).toEqual([...recorded.keys()].sort());
      for (const [id, cost] of shown) expect(cost, `${where} ${id} $/turn`).toBe(Number(recorded.get(id)!.toPrecision(2)));
    }
  });

  /** A fake OpenAI chat transport for the coordinator roles below; returns every request body it saw. */
  function fakeChatTransport(content: string) {
    vi.stubEnv("OPENAI_API_KEY", "test-key");
    const bodies: Record<string, unknown>[] = [];
    vi.stubGlobal("fetch", async (_u: string | URL, init?: RequestInit) => {
      bodies.push(JSON.parse(String(init?.body)));
      return new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status: 200 });
    });
    return bodies;
  }
  const expectGpt5Shape = (body: Record<string, unknown>) => {
    expect(body.model).toBe("gpt-5.4-mini");
    expect(body).not.toHaveProperty("temperature");
    expect(body).not.toHaveProperty("max_tokens");
  };

  it("migrateRetiredRoomModels pages planning workers: execution_plan rows with a retired id are rewritten and audited; web_research rows are not", async () => {
    const workerRows: Row[] = [
      { _id: "w1", roomId: "r1", kind: "execution_plan", model: "gpt-4.1-nano" },
      { _id: "w2", roomId: "r1", kind: "execution_plan", model: "gpt-5.4-mini" },
      { _id: "w3", roomId: "r1", kind: "web_research", model: "gpt-5.4" }, // OPENAI_WEB_MODEL caller argument
      { _id: "w4", roomId: "r1", kind: "web_research", model: "gpt-4.1-nano" }, // never written, but never touched either
      { _id: "w5", roomId: "r2", kind: "execution_plan" }, // no stored model: runV3Worker falls back to the (guarded) room model
      { _id: "w6", roomId: "r2", kind: "deterministic_count" },
    ];
    const { ctx, patches, inserted } = fakeMutationCtx([], workerRows);
    expect(await rooms.retireWorkerModels(ctx, null)).toMatchObject({ migrated: 1, isDone: true });
    expect(patches).toEqual([{ id: "w1", fields: { model: DEFAULT_MODEL } }]);
    expect(inserted).toHaveLength(1);
    expect(inserted[0]!.table).toBe("roomModelMigrations");
    expect(inserted[0]!.doc).toMatchObject({ roomId: "r1", workerId: "w1", from: "gpt-4.1-nano", to: DEFAULT_MODEL });
    expect(workerRows.map((w) => w.model)).toEqual([DEFAULT_MODEL, "gpt-5.4-mini", "gpt-5.4", "gpt-4.1-nano", undefined, undefined]);
    expect((await rooms.retireWorkerModels(ctx, null)).migrated).toBe(0); // idempotent
    // the internalMutation dispatches on `table`, defaulting to rooms
    const viaMutation = fakeMutationCtx([{ _id: "r9", model: "gpt-4.1-nano" }], [{ _id: "w9", roomId: "r9", kind: "execution_plan", model: "gpt-4.1-nano" }]);
    await rooms.migrateRetiredRoomModels._handler(viaMutation.ctx, { table: "workers" });
    expect(viaMutation.patches.map((p) => p.id)).toEqual(["w9"]);
    await rooms.migrateRetiredRoomModels._handler(viaMutation.ctx, {});
    expect(viaMutation.patches.map((p) => p.id)).toEqual(["w9", "r9"]);
  });

  /** Fake Convex db for retryV3Worker: get/insert/patch plus the traces scan insertTrace does. */
  function fakeRetryCtx(room: Row, worker: Row) {
    const rows = new Map<string, Row>([["room1", room], [worker._id, worker]]);
    const inserts: { table: string; doc: Row }[] = [];
    const ctx = {
      db: {
        get: async (id: string) => rows.get(id) ?? null,
        insert: async (table: string, doc: Row) => {
          const id = `${table}:${inserts.length}`;
          inserts.push({ table, doc });
          rows.set(id, { _id: id, ...doc });
          return id;
        },
        patch: async (id: string, fields: Row) => void Object.assign(rows.get(id)!, fields),
        delete: async (id: string) => void rows.delete(id),
        query: () => ({ withIndex: () => ({ collect: async () => [] }) }),
      },
      scheduler: { runAfter: vi.fn(async () => undefined) },
    };
    return { ctx: ctx as any, rows, inserts };
  }

  /** retryV3Worker on `stored`, then run the worker row it queued through runV3Worker; return the OpenAI request body. */
  async function retryThenRun(stored: Row, room: Row) {
    const { ctx, rows, inserts } = fakeRetryCtx(room, stored);
    const out = await rooms.retryV3Worker._handler(ctx, { roomId: "room1", workerId: stored._id });
    expect(out).toMatchObject({ reused: false });
    const retried = inserts.find((i) => i.table === "workers")!.doc;
    expect(retried.retryOf).toBe(stored._id);
    const bodies = fakeChatTransport("# Plan");
    const runQuery = vi.fn(async () => ({ worker: rows.get(out.workerId)!, goal: { title: "G" }, task: null, room }));
    const runMutation = vi.fn(async (_ref: unknown, a: Record<string, unknown>) => ("workerId" in a && !("error" in a) && !("content" in a) ? { started: true } : undefined));
    await coordinator.runV3Worker._handler({ runQuery, runMutation } as any, { workerId: out.workerId });
    expect(bodies).toHaveLength(1);
    return { body: bodies[0]!, retried };
  }
  const retryRoom = { ...baseRoom, model: "gpt-5.4-mini", budgetMaxWorkers: 9, budgetWorkersUsed: 1, permissionWebResearch: true };

  it("a pre-change planning worker retried after the migration requests gpt-5.4-mini; unmigrated, retry resends the stored retired id", async () => {
    const preChange = (): Row => ({ _id: "w1", roomId: "room1", goalId: "g1", kind: "execution_plan", status: "failed", title: "Draft execution plan", model: "gpt-4.1-nano", attempt: 1 });

    // without the migration the retired id is copied by retryV3Worker and sent by runV3Worker (this is the defect)
    const unmigrated = await retryThenRun(preChange(), retryRoom);
    expect(unmigrated.retried.model).toBe("gpt-4.1-nano");
    expect(unmigrated.body.model).toBe("gpt-4.1-nano");

    // with it, the retry carries the default and the request has the gpt-5 shape
    const stored = preChange();
    const { ctx } = fakeMutationCtx([], [stored]);
    await rooms.retireWorkerModels(ctx, null);
    const { body, retried } = await retryThenRun(stored, retryRoom);
    expect(retried.model).toBe(DEFAULT_MODEL);
    expectGpt5Shape(body);
    expect(body.max_completion_tokens).toBe(1800);
  });

  it("a planning worker still running when the migration runs does not restore the retired id on completion; the retry sends the default", async () => {
    const stored: Row = { _id: "w1", roomId: "room1", goalId: "g1", kind: "execution_plan", status: "running", title: "Draft execution plan", model: "gpt-4.1-nano", attempt: 1 };
    // 1. the worker was started on the retired id; the migration runs while its OpenAI call is in flight
    expect(await rooms.retireWorkerModels(fakeMutationCtx([], [stored]).ctx, null)).toMatchObject({ migrated: 1 });
    expect(stored.model).toBe(DEFAULT_MODEL);
    // 2. the call finishes and runPlanningWorker echoes the id it was given
    const { ctx, rows } = fakeRetryCtx(retryRoom, stored);
    rows.set("g1", { _id: "g1" });
    await rooms.completeV3Worker._handler(ctx, { workerId: "w1", title: "Plan", content: "# Plan", summary: "s", model: "gpt-4.1-nano" });
    expect(stored).toMatchObject({ status: "completed", model: DEFAULT_MODEL });
    // 3. a later retry sends the default in the gpt-5 request shape
    const { body, retried } = await retryThenRun(stored, retryRoom);
    expect(retried.model).toBe(DEFAULT_MODEL);
    expectGpt5Shape(body);
  });

  it("completion still records the model a worker ran on: valid ids for planning, any id for web_research", async () => {
    for (const [kind, model, expected] of [["execution_plan", "gpt-5.4-mini", "gpt-5.4-mini"], ["web_research", "gpt-5.4", "gpt-5.4"], ["web_research", "gpt-4.1-nano", "gpt-4.1-nano"]] as const) {
      const stored: Row = { _id: "w1", roomId: "room1", goalId: "g1", kind, status: "running", title: "t", attempt: 1 };
      const { ctx, rows } = fakeRetryCtx(retryRoom, stored);
      rows.set("g1", { _id: "g1" });
      await rooms.completeV3Worker._handler(ctx, { workerId: "w1", title: "t", content: "c", summary: "s", model });
      expect(stored.model).toBe(expected);
    }
  });

  it("a web_research worker retried after the migration keeps its stored model (OPENAI_WEB_MODEL caller argument)", async () => {
    const stored: Row = { _id: "w2", roomId: "room1", goalId: "g1", kind: "web_research", status: "completed", title: "Research", model: "gpt-5.4", attempt: 1 };
    const { ctx, patches } = fakeMutationCtx([], [stored]);
    await rooms.retireWorkerModels(ctx, null);
    expect(patches).toEqual([]);
    const { body, retried } = await retryThenRun(stored, retryRoom);
    expect(retried.model).toBe("gpt-5.4");
    expect(body.model).toBe("gpt-5.4");
  });

  it("the human-steer interpreter for a stale room requests gpt-5.4-mini in the gpt-5 request shape", async () => {
    const bodies = fakeChatTransport(JSON.stringify({ kind: "none", confidence: 1, reason: "backchannel" }));
    const room = { goal: "Plan a launch", model: "gpt-4.1-nano", profile: "v1_room_state", pendingHuman: "sounds good", pendingHumanSeq: 1 };
    const runQuery = vi.fn().mockResolvedValueOnce(room).mockResolvedValueOnce({ utterances: [] }); // getRoomRaw, then watchRoom
    const runMutation = vi.fn(async () => ({ applied: true }));
    await coordinator.interpretHumanSteer._handler({ runQuery, runMutation } as any, { roomId: "room1", text: "sounds good", seq: 1 });
    expect(bodies).toHaveLength(1);
    expectGpt5Shape(bodies[0]!);
    expect(bodies[0]!.max_completion_tokens).toBe(1000);
  });

  /** In-memory Convex db for the steer -> spawn path: get/insert/patch/delete plus the traces index scan. */
  function fakeSteerCtx(room: Row) {
    const rows = new Map<string, Row>([["room1", room]]);
    const inserts: { table: string; doc: Row }[] = [];
    const ctx = {
      db: {
        get: async (id: string) => rows.get(id) ?? null,
        insert: async (table: string, doc: Row) => {
          const id = `${table}:${inserts.length}`;
          inserts.push({ table, doc });
          rows.set(id, { _id: id, ...doc });
          return id;
        },
        patch: async (id: string, fields: Row) => void Object.assign(rows.get(id)!, fields),
        delete: async (id: string) => void rows.delete(id),
        query: () => ({ withIndex: () => ({ collect: async () => [] }) }),
      },
      scheduler: { runAfter: vi.fn(async () => undefined) },
    };
    return { ctx: ctx as any, rows, inserts };
  }

  it("a planning worker spawned by a human steer in a stale room requests gpt-5.4-mini in the gpt-5 request shape", async () => {
    // The room was NOT migrated (deploy-to-migration window): rooms.model is still the retired id.
    const room: Row = {
      _id: "room1", ...baseRoom, model: "gpt-4.1-nano", profile: "v3_agent_ecosystem", running: true, runToken: 1, turn: 0,
      pendingHuman: "also draft a launch plan", pendingHumanSeq: 1,
    };
    const { ctx, rows, inserts } = fakeSteerCtx(room);
    const intent = { kind: "add_goal", goal: "Draft a launch plan", confidence: 1, reason: "parallel workstream" };
    await rooms.applyHumanIntent._handler(ctx, { roomId: "room1", text: "also draft a launch plan", seq: 1, intent, source: "llm" });

    const workers = inserts.filter((i) => i.table === "workers").map((i) => i.doc);
    expect(workers.map((w) => w.kind)).toEqual(["web_research", "execution_plan"]);
    expect(workers[1]!.model).toBe("gpt-5.4-mini"); // spawn-time guard: the retired id is never stored on a new worker
    expect(workers[0]!.model).toBe("gpt-4.1-mini"); // the web model is not a router row and stays as written
    const planning = [...rows.values()].find((r) => r.kind === "execution_plan")!;

    const bodies = fakeChatTransport("# Plan\n- objective: launch");
    const runQuery = vi.fn(async () => ({ worker: planning, goal: { title: "Draft a launch plan" }, task: null, room }));
    const runMutation = vi.fn(async (_ref: unknown, a: Record<string, unknown>) => ("workerId" in a && !("error" in a) && !("content" in a) ? { started: true } : undefined));
    await coordinator.runV3Worker._handler({ runQuery, runMutation } as any, { workerId: planning._id });
    expect(runMutation.mock.calls.some(([, a]) => "error" in (a as object))).toBe(false); // completed, not failed
    expect(bodies).toHaveLength(1);
    expectGpt5Shape(bodies[0]!);
    expect(bodies[0]!.max_completion_tokens).toBe(1800);
  });

  it("a planning worker row with no stored model still gets a valid id for a stale room (runV3Worker fallback)", async () => {
    const bodies = fakeChatTransport("# Plan");
    const worker = { kind: "execution_plan", title: "Draft execution plan" };
    const runQuery = vi.fn(async () => ({ worker, goal: { title: "G" }, task: null, room: { goal: "Plan", model: "gpt-4.1-nano" } }));
    const runMutation = vi.fn(async (_ref: unknown, a: Record<string, unknown>) => ("workerId" in a && !("error" in a) && !("content" in a) ? { started: true } : undefined));
    await coordinator.runV3Worker._handler({ runQuery, runMutation } as any, { workerId: "w1" });
    expectGpt5Shape(bodies[0]!);
  });
});
