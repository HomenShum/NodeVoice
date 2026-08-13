# Integrations

Everything this app talks to, what happens without it, and where the call is
made. **Nothing here is required to run the demo.** `npm start` plus
`npm run build` gives a working product with zero accounts.

## Outbound services

| Service | Where the call lives | Needed for | Without it |
|---|---|---|---|
| OpenAI chat | `src/providers/openai.ts`, `src/live/pipeline.ts:generateAgentTurn`, `convex/openai.ts` | Agents that improvise instead of following a script | `/compare/demo` with `source: "openai"` is refused with HTTP 400 naming the missing key; the default `deterministic` source is unaffected |
| OpenAI Whisper (speech to text) | `src/live/pipeline.ts:transcribeAudio` | Speaking into a live room | The live room throws `"OPENAI_API_KEY is not configured on the server"` and shows it in the trace as "Auto-run halted on error" |
| OpenAI TTS | `src/live/pipeline.ts` (`TTS_PROVIDER=openai`, the default) | Agents speaking out loud in a live room | Same named failure |
| ElevenLabs TTS | `src/live/pipeline.ts` (`TTS_PROVIDER=elevenlabs`) | Nicer voices | Same named failure |
| Ollama (local models) | `src/providers/ollama.ts` | Running the demo against a model on your own machine | `isOllamaAvailable()` answers within 800 ms and the run silently falls back to the deterministic script |
| Convex | `convex/**`, `src/client/live/useConvexRoom.ts` | The hosted deployment only | With `VITE_CONVEX_URL` unset (the default) no Convex code is loaded at all |

Every outbound call is wrapped in `withTimeout` with an `AbortController`, and
every response body has a size cap (`MAX_TTS_BYTES` 5 MB, `MAX_STT_BYTES`
20 MB). Keys are read from the server environment at call time and never sent to
the browser.

## Environment variables

**Server** (`src/server.ts` loads `.env.local` if present; it is gitignored):

| Variable | Default | Effect |
|---|---|---|
| `PORT` | `8787` | HTTP port |
| `OPENAI_API_KEY` | unset | Enables the OpenAI source and live voice |
| `ELEVENLABS_API_KEY` | unset | Enables ElevenLabs TTS |
| `OPENAI_MODEL` | `gpt-5.4-mini` | Live-room chat model |
| `STT_MODEL` | `whisper-1` | Speech to text |
| `TTS_PROVIDER` | `openai` | `openai` or `elevenlabs` |
| `OPENAI_TTS_MODEL` | `gpt-4o-mini-tts` | |
| `ELEVENLABS_MODEL` | `eleven_flash_v2_5` | |
| `REASONING_EFFORT` | `low` | Only sent to gpt-5 / o-series models |
| `OLLAMA_HOST` | `http://localhost:11434` | |
| `OLLAMA_MODEL` | `llama3.2:3b` | |

**Browser, at build time** (Vite inlines these; changing one needs a rebuild):

| Variable | Effect |
|---|---|
| `VITE_CONVEX_URL` | Set → the whole client uses the Convex transport. Unset → HTTP + SSE against the Node server. This is the single switch between the two backends. |
| `VITE_CONVEX_SITE_URL`, `VITE_LIVE_BASE` | Where live-room requests go when the client is hosted separately from the API |
| `VITE_DEMO_API_BASE` | Points `/demo` at a remote API |
| `VITE_DEMO_ENABLE_REMOTE_SOURCES` | `"true"` lets the hosted demo request non-deterministic sources; otherwise the hosted demo is pinned to the scripted source |

**CLI demos** also read `COUNT_TARGET`, `TURNS`, `SOURCE`, `USE_OLLAMA`
(used by `npm run demo:compare`, which is what CI runs).

## Deploying the hosted version

Recorded in the README under "Deploying your own": `npx convex deploy`, set
`OPENAI_API_KEY` in the Convex environment, then build the client with
`VITE_CONVEX_URL` and `VITE_LIVE_BASE` pointing at that deployment. Convex
bundles `convex/**` **and the `src/core/*` modules it imports** — verified by
running esbuild with Convex's own flags; see `docs/SIMPLIFICATION_REPORT.md`.

## What is deliberately absent

No analytics, no error reporting service, no feature flags, no auth provider. A
room is joinable by anyone holding its six-character code, and rooms marked
private are simply unlisted from the lobby (`src/live/roomServer.ts`, the
`private` flag). That is the security model, stated plainly so nobody assumes a
stronger one.
