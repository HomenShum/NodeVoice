#!/usr/bin/env node
/**
 * One-command live deploy:
 *   npm run live
 *
 * Builds the client, starts the room server (loads .env.local), opens a public
 * cloudflared HTTPS tunnel, and prints the URL to open on your laptop. Create a
 * room there, then scan the on-screen QR with your phone to add the second agent.
 *
 * Requires: cloudflared on PATH (or at the default Windows install path) and a
 * .env.local with OPENAI_API_KEY (TTS_PROVIDER defaults to openai).
 */
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const PORT = process.env.PORT ?? "8787";
const args = new Set(process.argv.slice(2));
const skipBuild = args.has("--no-build");

const children = [];
function cleanup() {
  for (const c of children) {
    try {
      c.kill();
    } catch {}
  }
}
process.on("SIGINT", () => {
  cleanup();
  process.exit(0);
});
process.on("exit", cleanup);

function run(cmd, argv, opts = {}) {
  return spawn(cmd, argv, { cwd: root, shell: process.platform === "win32", ...opts });
}

async function waitFor(fn, label, timeoutMs = 60_000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await fn()) return true;
    await new Promise((r) => setTimeout(r, 700));
  }
  throw new Error(`timed out waiting for ${label}`);
}

function cloudflaredPath() {
  const win = "C:/Program Files (x86)/cloudflared/cloudflared.exe";
  if (process.platform === "win32" && existsSync(win)) return win;
  return "cloudflared";
}

async function main() {
  // 1. build
  if (!skipBuild) {
    console.log("▸ building client…");
    await new Promise((res, rej) => {
      const b = run("npx", ["vite", "build"], { stdio: "inherit" });
      b.on("exit", (code) => (code === 0 ? res() : rej(new Error("build failed"))));
    });
  }

  // 2. server
  console.log("▸ starting room server on :" + PORT + "…");
  const server = run("npx", ["tsx", "src/server.ts"], {
    stdio: ["ignore", "inherit", "inherit"],
    env: { ...process.env, PORT, TTS_PROVIDER: process.env.TTS_PROVIDER ?? "openai" },
  });
  children.push(server);

  await waitFor(async () => {
    try {
      const r = await fetch(`http://localhost:${PORT}/health`);
      return r.ok;
    } catch {
      return false;
    }
  }, "server /health");

  // 3. tunnel — spawn WITHOUT a shell: the cloudflared path contains spaces and
  // shell:true would mangle it. spawn passes the exe path to CreateProcess as-is.
  console.log("▸ opening public tunnel…");
  const cf = spawn(cloudflaredPath(), ["tunnel", "--url", `http://localhost:${PORT}`, "--no-autoupdate"], {
    cwd: root,
    shell: false,
    stdio: ["ignore", "pipe", "pipe"],
  });
  children.push(cf);

  let url = null;
  const onData = (buf) => {
    const m = String(buf).match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
    if (m && !url) {
      url = m[0];
      banner(url);
    }
  };
  cf.stdout.on("data", onData);
  cf.stderr.on("data", onData);

  await waitFor(async () => url != null, "tunnel url");
}

function banner(url) {
  const line = "─".repeat(url.length + 8);
  console.log(`
┌${line}┐
│    ROOM OS · LIVE is up 🎙️${" ".repeat(Math.max(0, url.length - 18))}│
└${line}┘

  Open on your LAPTOP:   ${url}
  → click "Create room", then scan the on-screen QR with your PHONE.

  The link works only while this process + your laptop stay awake.
  Press Ctrl-C to stop.
`);
}

main().catch((e) => {
  console.error("live launcher failed:", e.message);
  cleanup();
  process.exit(1);
});
