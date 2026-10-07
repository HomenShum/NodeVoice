import { createServer, type ServerResponse } from "node:http";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { extname, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createVoiceRoom } from "./core/roomReducer.js";
import { validTurns } from "./core/agents.js";
import { validCountTarget } from "./core/steering.js";
import { VOICE_AGENT_IDS } from "./core/types.js";
import { runVoiceStep } from "./voice/voiceAgent.js";
import { runLocalNodeAgentLoop } from "./nodeagents/nodeAgentLocalMvp.js";
import { CLOUD_ONLY_REFERENCE_MODELS, DEFAULT_NODEAGENT_MODEL_ID, DEFAULT_VOICE_MODEL_ID, LOCAL_MODEL_OPTIONS, MODEL_CATALOG_REFRESHED_AT, getModelsFor, getOllamaModelName } from "./providers/localModels.js";
import { runSideBySideComparison, type ComparisonSource } from "./compare/badGoodDemo.js";
import { handleLive, readJson } from "./live/roomServer.js";

// Load server-side API keys (OpenAI / ElevenLabs) from a gitignored .env.local.
const envPath = resolve(fileURLToPath(new URL("../.env.local", import.meta.url)));
const loadEnvFile = (process as unknown as { loadEnvFile?: (p: string) => void }).loadEnvFile;
try {
  loadEnvFile?.(envPath);
} catch {
  /* .env.local is optional (live voice room disabled without keys) */
}

const port = Number(process.env.PORT ?? "8787");
// The browser UI is the Vite build in dist/. There is exactly one client; if it
// has not been built the API still answers and the page says so, rather than a
// second, older UI being served silently from somewhere else.
const staticDir = resolve(fileURLToPath(new URL("../dist", import.meta.url)));

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? "/", "http://localhost");
    const path = url.pathname;

    if (req.method === "OPTIONS") {
      return empty(res, 204);
    }

    // Live multi-device voice room (SSE + POST). Handles its own responses.
    if (await handleLive(req, res, path)) return;

    if (req.method === "GET" && path === "/health") {
      return json(res, 200, {
        ok: true,
        service: "nodevoice",
        live: { openai: Boolean(process.env.OPENAI_API_KEY), elevenlabs: Boolean(process.env.ELEVENLABS_API_KEY) },
      });
    }

    if (req.method === "GET" && path === "/api/models") {
      return json(res, 200, {
        ok: true,
        refreshedAt: MODEL_CATALOG_REFRESHED_AT,
        defaults: {
          voice: DEFAULT_VOICE_MODEL_ID,
          nodeagent: DEFAULT_NODEAGENT_MODEL_ID,
        },
        all: LOCAL_MODEL_OPTIONS,
        cloudOnlyReference: CLOUD_ONLY_REFERENCE_MODELS,
        voice: getModelsFor("voice"),
        nodeagent: getModelsFor("nodeagent"),
        code: getModelsFor("code"),
        vision: getModelsFor("vision"),
        embedding: getModelsFor("embedding"),
      });
    }

    if (req.method === "POST" && path === "/compare/demo") {
      const body = await readJson<{
        target?: number;
        turns?: number;
        useOllama?: boolean;
        model?: string;
        source?: string;
        openaiModel?: string;
      }>(req);
      const source: ComparisonSource =
        body.source === "openai" || body.source === "ollama" || body.source === "deterministic"
          ? body.source
          : body.useOllama
            ? "ollama"
            : "deterministic";
      if (source === "openai" && !process.env.OPENAI_API_KEY) {
        return json(res, 400, {
          ok: false,
          error: "openai source requested but OPENAI_API_KEY is not set in .env.local on the server",
        });
      }
      const model = getOllamaModelName(body.model, DEFAULT_VOICE_MODEL_ID);
      const result = await runSideBySideComparison({
        target: body.target,
        turns: body.turns,
        source,
        useOllama: source === "ollama",
        model,
        openaiModel: body.openaiModel,
      });
      return json(res, 200, result);
    }

    if (req.method === "POST" && path === "/voice/demo") {
      const body = await readJson<{ target?: number; turns?: number; useOllama?: boolean; model?: string }>(req);
      const model = getOllamaModelName(body.model, DEFAULT_VOICE_MODEL_ID);
      let state = createVoiceRoom(validCountTarget(body.target, 20));
      const maxTurns = validTurns(body.turns, 20);
      for (let i = 0; i < maxTurns && state.task.kind === "count_to_n" && !state.task.completed; i += 1) {
        const actorId = state.nextSpeaker ?? VOICE_AGENT_IDS[0]!;
        state = await runVoiceStep(state, {
          actorId,
          label: actorId,
          useOllama: body.useOllama ?? false,
          model,
        });
      }
      return json(res, 200, state);
    }

    if (req.method === "POST" && path === "/nodeagents/run") {
      const body = await readJson<{ goal?: string; useOllama?: boolean; model?: string }>(req);
      const model = getOllamaModelName(body.model, DEFAULT_NODEAGENT_MODEL_ID);
      const result = await runLocalNodeAgentLoop(
        body.goal ?? "Build local-first room-state MVP for voice agents and NodeAgents.",
        body.useOllama ?? false,
        model,
      );
      return json(res, 200, result);
    }

    if (req.method === "GET") {
      return serveStatic(path, res);
    }

    return json(res, 404, { ok: false, error: "not_found" });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message === "body too large") {
      // The caller's fault, so say 413 rather than resetting the connection —
      // and close it, because the rest of their upload is still arriving and
      // the socket cannot be reused for the next request.
      res.writeHead(413, corsHeaders({ "content-type": "application/json; charset=utf-8", connection: "close" }));
      return res.end(JSON.stringify({ ok: false, error: message }, null, 2));
    }
    return json(res, 500, { ok: false, error: message });
  }
});

server.listen(port, () => {
  console.log(`nodevoice server running on http://localhost:${port}`);
  if (!existsSync(staticDir)) console.log("NOTE: dist/ is missing — run `npm run build` (or `npm run ui`) to get the browser UI. API routes below work regardless.");
  console.log("GET  /               tiny browser UI");
  console.log("GET  /api/models     local model dropdown data");
  console.log("POST /compare/demo   { target, turns, source, model, openaiModel }");
  console.log("POST /voice/demo     { target, turns, useOllama, model }");
  console.log("POST /nodeagents/run { goal, useOllama, model }");
  console.log(`LIVE /live/*         voice room (openai:${Boolean(process.env.OPENAI_API_KEY)} elevenlabs:${Boolean(process.env.ELEVENLABS_API_KEY)})`);
});

async function serveStatic(path: string, res: ServerResponse): Promise<void> {
  const requested = path === "/" ? "/index.html" : path;
  const normalized = normalize(requested).replace(/^\/+/, "");
  const filePath = resolve(join(staticDir, normalized));
  if (!filePath.startsWith(staticDir)) return json(res, 403, { ok: false, error: "forbidden" });

  try {
    const file = await readFile(filePath);
    res.writeHead(200, { "content-type": contentType(filePath) });
    res.end(file);
  } catch {
    // Single-page app: unknown GET paths fall back to index.html so deep links
    // like /demo work on reload.
    try {
      const file = await readFile(resolve(join(staticDir, "index.html")));
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(file);
    } catch {
      json(res, 404, { ok: false, error: "client_not_built", hint: "run `npm run build` (or `npm run ui`)" });
    }
  }
}

function json(res: ServerResponse, statusCode: number, payload: unknown): void {
  const body = JSON.stringify(payload, null, 2);
  res.writeHead(statusCode, corsHeaders({ "content-type": "application/json; charset=utf-8" }));
  res.end(body);
}

function empty(res: ServerResponse, statusCode: number): void {
  res.writeHead(statusCode, corsHeaders({}));
  res.end();
}

function corsHeaders(headers: Record<string, string>): Record<string, string> {
  return {
    ...headers,
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET,POST,OPTIONS",
    "access-control-allow-headers": "content-type",
  };
}

function contentType(filePath: string): string {
  switch (extname(filePath)) {
    case ".html":
      return "text/html; charset=utf-8";
    case ".css":
      return "text/css; charset=utf-8";
    case ".js":
      return "text/javascript; charset=utf-8";
    case ".json":
      return "application/json; charset=utf-8";
    case ".txt":
      return "text/plain; charset=utf-8";
    case ".xml":
      return "application/xml; charset=utf-8";
    case ".svg":
      return "image/svg+xml";
    case ".ico":
      return "image/x-icon";
    case ".woff":
      return "font/woff";
    case ".woff2":
      return "font/woff2";
    case ".ttf":
      return "font/ttf";
    case ".map":
      return "application/json; charset=utf-8";
    default:
      return "application/octet-stream";
  }
}
