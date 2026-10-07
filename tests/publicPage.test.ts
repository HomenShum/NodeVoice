import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createServer, preview, type PreviewServer } from "vite";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const canonical = "https://nodevoice.vercel.app/";
let output: string;
let server: PreviewServer | undefined;
let base: string;

describe("a search visitor reaches the real public lobby before JavaScript", () => {
  beforeAll(async () => {
    output = await mkdtemp(join(tmpdir(), "nodevoice-public-page-"));
    // Exercise actual process termination: an imported browser scheduler once
    // kept `vite build` alive after it printed a successful build message.
    await promisify(execFile)(process.execPath, [join(root, "node_modules/vite/bin/vite.js"), "build", "--outDir", output], {
      cwd: root,
      env: { ...process.env, NODE_ENV: "production", VITE_CONVEX_URL: "", VITE_LIVE_BASE: "" },
      timeout: 60_000,
      maxBuffer: 2_000_000,
    });
    server = await preview({ configFile: join(root, "vite.config.ts"), root: join(root, "src/client"), build: { outDir: output }, preview: { host: "127.0.0.1", port: 0 } });
    const address = server.httpServer.address();
    if (!address || typeof address === "string") throw new Error("Preview did not bind a TCP port");
    base = `http://127.0.0.1:${address.port}`;
  }, 90_000);

  afterAll(async () => {
    try { await server?.close(); }
    finally {
      if (output) {
        expect(resolve(output).startsWith(resolve(tmpdir()) + sep)).toBe(true);
        await rm(output, { recursive: true, force: true });
      }
    }
  });

  it("delivers real copy, initial disabled controls, metadata and directly linked styles", async () => {
    const response = await fetch(base);
    expect(response.status).toBe(200);
    const html = await response.text();
    expect(html).toContain("Start a live room. Voice");
    expect(html).toContain("Join a room");
    expect(html).toContain("Create room");
    expect(html).toMatch(/<fieldset[^>]*disabled/);
    expect(html).toContain("Enable JavaScript to create or join a voice room.");
    expect(html).not.toContain("<!--public-lobby-->");
    expect(html).toContain(`rel="canonical" href="${canonical}"`);
    expect(html).toContain(`property="og:url" content="${canonical}"`);
    expect(html).toMatch(/<meta name="description" content="[^"]{40,}"/);
    const cssPath = html.match(/<link[^>]*rel="stylesheet"[^>]*href="([^"]+)"/)?.[1];
    expect(cssPath).toBeTruthy();
    const css = await fetch(new URL(cssPath!, base));
    expect(css.status).toBe(200);
    expect(css.headers.get("content-type")).toContain("text/css");
    expect((await css.text()).length).toBeGreaterThan(1000);
  });

  it("serves crawler documents as text/XML and lists only the public canonical", async () => {
    const robots = await fetch(`${base}/robots.txt`);
    expect(robots.status).toBe(200);
    expect(robots.headers.get("content-type")).toContain("text/plain");
    const rules = await robots.text();
    expect(rules).toContain(`Sitemap: ${canonical}sitemap.xml`);
    expect(rules).toContain("Disallow: /*?*room=");
    expect(rules).not.toContain("<html");
    const sitemap = await fetch(`${base}/sitemap.xml`);
    expect(sitemap.status).toBe(200);
    expect(sitemap.headers.get("content-type")).toMatch(/(?:application|text)\/xml/);
    const xml = await sitemap.text();
    expect([...xml.matchAll(/<loc>(.*?)<\/loc>/g)].map(match => match[1])).toEqual([canonical]);
  });

  it("keeps repeated and concurrent crawler visits stable without leaking request content", async () => {
    const original = await (await fetch(base)).text();
    for (let wave = 0; wave < 8; wave++) {
      const responses = await Promise.all(Array.from({ length: 8 }, async (_, index) => {
        const response = await fetch(`${base}/?utm_source=visitor-${wave}-${index}`);
        expect(response.status).toBe(200);
        return response.text();
      }));
      expect(responses).toEqual(Array(8).fill(original));
    }
  });

  it("keeps crawlers and assets outside the provider's existing app rewrite", async () => {
    const config = JSON.parse(await readFile(join(root, "vercel.json"), "utf8"));
    const route = new RegExp(`^${config.rewrites[0].source}$`);
    for (const file of ["/robots.txt", "/sitemap.xml", "/assets/app.js"]) expect(route.test(file)).toBe(false);
    for (const appPath of ["/", "/demo", "/demo/comparison", "/room-entry"]) expect(route.test(appPath)).toBe(true);
    expect(config.rewrites[0].destination).toBe("/index.html");
  });

  it("renders the hosted transport without opening network connections or importing the demo scheduler", async () => {
    const renderer = await createServer({
      configFile: join(root, "vite.config.ts"), root: join(root, "src/client"),
      define: { "import.meta.env.VITE_CONVEX_URL": JSON.stringify("https://nodevoice-render-proof.convex.cloud") },
      optimizeDeps: { noDiscovery: true, include: [] },
      server: { middlewareMode: true, hmr: false, watch: null },
    });
    try {
      const { renderPublicLobby } = await renderer.ssrLoadModule("/entry-server.tsx");
      const originalFetch = globalThis.fetch;
      const originalSocket = globalThis.WebSocket;
      let networkCalls = 0;
      globalThis.fetch = (() => { networkCalls++; throw new Error("Build attempted HTTP"); }) as typeof fetch;
      globalThis.WebSocket = class { constructor() { networkCalls++; throw new Error("Build attempted WebSocket"); } } as unknown as typeof WebSocket;
      try {
        for (let run = 0; run < 12; run++) {
          const html = await renderPublicLobby();
          expect(html).toContain("Create room");
          expect(html).toContain("Join a room");
          expect(html).not.toContain("or watch the bad-vs-good demo");
          expect(html).not.toContain("nodevoice-render-proof");
        }
        expect(networkCalls).toBe(0);
      } finally { globalThis.fetch = originalFetch; globalThis.WebSocket = originalSocket; }
    } finally { await renderer.close(); }
  }, 30_000);
});
