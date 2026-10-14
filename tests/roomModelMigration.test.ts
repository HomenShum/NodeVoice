import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_MODEL, ROUTER_MODELS, validModel } from "../src/core/routerModels.js";

// convex/*.ts are type-checked by `npm run check:convex` (Convex module settings); the root
// `tsc` cannot compile them, so they are loaded by a non-literal specifier, as the app
// bundler does. Everything the tests call on them is asserted at runtime.
const load = (path: string) => import(/* @vite-ignore */ path);
const rooms = await load("../convex/rooms.ts");
const coordinator = await load("../convex/coordinator.ts");

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
/** In-memory stand-in for a Convex MutationCtx: just the db calls the migration makes. */
function fakeMutationCtx(roomRows: Row[]) {
  const patches: { id: string; fields: Row }[] = [];
  const inserted: { table: string; doc: Row }[] = [];
  const ctx = {
    db: {
      query: (table: string) => ({
        paginate: async ({ numItems, cursor }: { numItems: number; cursor: string | null }) => {
          expect(table).toBe("rooms");
          const start = cursor ? Number(cursor) : 0;
          const page = roomRows.slice(start, start + numItems);
          const end = start + page.length;
          return { page, isDone: end >= roomRows.length, continueCursor: String(end) };
        },
      }),
      patch: async (id: string, fields: Row) => {
        patches.push({ id, fields });
        Object.assign(roomRows.find((r) => r._id === id)!, fields);
      },
      insert: async (table: string, doc: Row) => void inserted.push({ table, doc }),
    },
  };
  return { ctx: ctx as any, patches, inserted };
}

describe("retired router model: gpt-4.1-nano", () => {
  it("was a selectable id before the change and is not now", () => {
    expect(preChangeValidModel("gpt-4.1-nano")).toBe("gpt-4.1-nano"); // the stale value is reachable
    expect(ROUTER_MODELS.map((m) => m.id)).not.toContain("gpt-4.1-nano");
    expect(validModel("gpt-4.1-nano")).toBe(DEFAULT_MODEL);
    expect(ROUTER_MODELS).toHaveLength(5);
  });

  it("marks the gpt-5 rows as retiring 2026-12-11 in the picker", () => {
    for (const id of ["gpt-5-nano", "gpt-5-mini"]) {
      expect(ROUTER_MODELS.find((m) => m.id === id)?.note, id).toContain("retires 2026-12-11");
    }
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
    // idempotent: the second run (before + after the deploy) finds nothing to do
    const again = await rooms.retireRoomModels(ctx, null);
    expect(again.migrated).toBe(0);
  });

  it("the coordinator's next turn for a stale room requests gpt-5.4-mini in the gpt-5 request shape", async () => {
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
    const runMutation = vi.fn(async () => ({ committed: true }));
    const ctx = { runQuery: vi.fn(async () => ({ utterances: [] })), runMutation } as any;
    const staleRoom = { goal: "Plan a launch", model: "gpt-4.1-nano", floorOwner: "agent-001", agentCount: 2, goalVersion: 0, recentActs: [] };

    const out = await coordinator.produceTurn(ctx, "room1" as any, staleRoom, 1);

    expect(out.committed).toBe(true);
    const chat = bodies.find((b) => b.url.endsWith("/chat/completions"))!;
    expect(chat.body.model).toBe("gpt-5.4-mini");
    // gpt-5.x shape: the 4.x-only keys must be absent
    expect(chat.body).not.toHaveProperty("temperature");
    expect(chat.body).not.toHaveProperty("max_tokens");
    expect(chat.body.max_completion_tokens).toBe(1500);
    expect(chat.body.reasoning_effort).toBe("low");
    expect(bodies.some((b) => b.body.model === "gpt-4.1-nano")).toBe(false);
  });
});
