import { execFile } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { expect, it } from "vitest";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

it("renders two independent 100-turn investigations, handles replacement and hostile text, then exits naturally", async () => {
  // A real subprocess catches retained framework handles; SSR does not prove client effects or scrolling.
  const probe = `
    import assert from "node:assert/strict";
    import { resolve } from "node:path";
    import { createElement, Fragment } from "react";
    import { renderToStaticMarkup } from "react-dom/server";
    import { createServer } from "vite";
    const server = await createServer({
      configFile: resolve("vite.config.ts"), root: resolve("src/client"),
      optimizeDeps: { noDiscovery: true, include: [] },
      server: { middlewareMode: true, hmr: false, watch: null },
    });
    let renders = 0;
    try {
      const { TraceTreeView, compareStepsToSpans } = await server.ssrLoadModule("/components/agents-ui/trace-tree-view.tsx");
      const { runSideBySideComparison } = await server.ssrLoadModule(resolve("src/compare/badGoodDemo.ts"));
      const comparison = await runSideBySideComparison({ target: 100, turns: 100, source: "deterministic" });
      assert.equal(comparison.provenance.mode, "deterministic");
      const bad = compareStepsToSpans(comparison.bad, "bad");
      const good = compareStepsToSpans(comparison.good, "good");
      assert.equal(bad.length, 100); assert.equal(good.length, 100);
      const render = (left, right, active) => {
        renders++;
        return renderToStaticMarkup(createElement(Fragment, null,
          createElement(TraceTreeView, { spans: left, accentColor: "bad", activeIndex: active }),
          createElement(TraceTreeView, { spans: right, accentColor: "good", activeIndex: active })));
      };
      const ids = html => [...html.matchAll(/data-span-id="([^"]+)"/g)].map(match => match[1]);
      for (const active of [-1, 0, 99, 100, 10000]) {
        const html = render(bad, good, active);
        assert.deepEqual(ids(html), [...bad, ...good].map(span => span.id));
        assert.equal((html.match(/data-span-depth="0"/g) ?? []).length, 200);
        assert.equal((html.match(/animate-fade-in-up/g) ?? []).length, active === 0 || active === 99 ? 2 : 0);
        assert.ok(html.includes("voice-a: One hundred"));
        assert.ok(html.includes('data-span-type="instruction"'));
        assert.ok(html.includes('data-span-type="task_action"'));
        assert.ok(html.includes('data-span-status="completed"'));
      }
      const rejected = compareStepsToSpans([{ turn: 0, actorId: "error", speechAct: "error", text: "Error: compare request failed: 503", roomStateSummary: "" }], "bad");
      const rejectedHtml = render(rejected, [], 99);
      assert.deepEqual(ids(rejectedHtml), ["bad-0"]);
      assert.ok(rejectedHtml.includes('data-span-status="failed"'), "a rejected request must not become a completed trace");
      assert.ok(!rejectedHtml.includes('data-span-status="completed"'));
      const hostile = [{ ...good[0], name: '<script>window.stolen=1</script> & "quoted"', status: "failed" }];
      const hostileHtml = render([], hostile, 0);
      assert.deepEqual(ids(hostileHtml), ["good-1"]);
      assert.ok(hostileHtml.includes("&lt;script&gt;")); assert.ok(!hostileHtml.includes("<script>"));
      assert.ok(hostileHtml.includes('data-span-status="failed"'));
      for (let round = 0; round < 24; round++) {
        const empty = render([], [], 99);
        assert.deepEqual(ids(empty), []);
        assert.equal((empty.match(/Waiting for trace data/g) ?? []).length, 2);
        const replacement = good.slice(0, 3).map(span => ({ ...span, name: "replacement-" + round + ": " + span.name }));
        const html = render(bad.slice(0, 7), replacement, 2);
        assert.deepEqual(ids(html), [...bad.slice(0, 7), ...replacement].map(span => span.id));
        assert.ok(html.includes("replacement-" + round + ": voice-a: One"));
        assert.ok(!html.includes("voice-a: One hundred"));
      }
      console.log(JSON.stringify({ renders, turnsPerPane: 100, mode: comparison.provenance.mode }));
    } finally { await server.close(); }
  `;
  const { stdout } = await promisify(execFile)(process.execPath, ["--input-type=module", "--eval", probe], {
    cwd: root,
    env: { ...process.env, VITE_CONVEX_URL: "", VITE_CONVEX_SITE_URL: "", VITE_DEMO_API_BASE: "", VITE_LIVE_BASE: "" },
    timeout: 30_000,
    maxBuffer: 2_000_000,
    windowsHide: true,
  });
  expect(stdout).toContain('"renders":55,"turnsPerPane":100,"mode":"deterministic"');
}, 35_000);
