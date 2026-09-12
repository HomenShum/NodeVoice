import { createServer, defineConfig, type Plugin, type ResolvedConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";
import { execFileSync } from "node:child_process";

// Build identity, adapted from node-foyer's vite.config.ts (foyer-build-sha). Non-strict:
// unlike the Foyer's own build (which refuses to ship "unavailable" in production), NodeVoice
// has no gate that depends on this tag existing, so a git-less build environment just emits
// "unavailable" rather than failing.
const BUILD_SHA_PATTERN = /^[0-9a-f]{40}$/u;

function resolveBuildSha(): string {
  for (const value of [process.env.VERCEL_GIT_COMMIT_SHA, process.env.GITHUB_SHA]) {
    const sha = value?.trim().toLowerCase();
    if (sha && BUILD_SHA_PATTERN.test(sha)) return sha;
  }
  try {
    const sha = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8", timeout: 5_000, windowsHide: true }).trim();
    if (BUILD_SHA_PATTERN.test(sha)) return sha;
  } catch {
    // fall through to unavailable
  }
  return "unavailable";
}

function buildIdentityMeta(): Plugin {
  return {
    name: "nodevoice-build-identity",
    transformIndexHtml() {
      const sha = resolveBuildSha();
      return [
        {
          tag: "meta",
          attrs: {
            name: "nodevoice-build-sha",
            content: sha,
            "data-provenance": sha === "unavailable" ? "unavailable" : "commit",
          },
          injectTo: "head" as const,
        },
      ];
    },
  };
}

function publicLobby(): Plugin {
  let config: ResolvedConfig;
  return {
    name: "nodevoice-public-lobby",
    configResolved(resolved) { config = resolved; },
    transformIndexHtml: {
      order: "pre",
      async handler(html, context) {
        const marker = "<!--public-lobby-->";
        if (html.split(marker).length !== 2) {
          throw new Error("Public HTML must contain exactly one lobby rendering marker.");
        }
        const renderer = context.server ?? await createServer({
          configFile: false,
          root: config.root,
          envDir: config.envDir,
          mode: config.mode,
          define: config.define,
          resolve: { alias: config.resolve.alias },
          plugins: [react()],
          optimizeDeps: { noDiscovery: true, include: [] },
          appType: "custom",
          server: { middlewareMode: true, hmr: false, watch: null },
        });
        try {
          const { renderPublicLobby } = await renderer.ssrLoadModule("/entry-server.tsx");
          const rendered = await renderPublicLobby();
          return html.replace(marker, () => rendered);
        } finally {
          if (!context.server) await renderer.close();
        }
      },
    },
  };
}

export default defineConfig({
  plugins: [react(), publicLobby(), buildIdentityMeta()],
  root: "src/client",
  build: {
    outDir: "../../dist",
    emptyOutDir: true,
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src/client"),
    },
  },
  server: {
    port: 5173,
    proxy: {
      "/api": "http://localhost:8787",
      "/compare": "http://localhost:8787",
      "/voice": "http://localhost:8787",
      "/nodeagents": "http://localhost:8787",
      "/health": "http://localhost:8787",
      // Only proxy the live API sub-paths — NOT a blanket "/live", which would
      // also swallow client module requests for src/client/live/*.tsx in dev.
      "^/live/(rooms|audio)": { target: "http://localhost:8787", changeOrigin: true },
    },
  },
});
