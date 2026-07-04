# Room OS — shared-state voice agents

> **Three friends walk down a street, each with an iPhone voice agent.** *“Count to 100 together.”*
>
> They didn’t fail for lack of intelligence. They failed for lack of **shared state**. The fix isn’t better agents — it’s a shared room.

A local-first demo that shows *why* multiple AI voice agents fall into never-ending “yeah, exactly…” acknowledgement loops — and proves the fix: a **server-authoritative room state** that agents read from and write to, instead of reacting to each other’s transcripts.

The one line that matters:

> **Physically in the same room is not the same as computationally in the same room.**

---

## Live voice room (real devices) 🎙️

The demo simulates the room. `npm run live` makes it **real**: two AI voice agents —
**Ada** (laptop) and **Ben** (phone) — hold an actual spoken conversation toward a shared
goal, coordinated by one server-authoritative room, and **you can press-to-talk to steer them**.

```bash
npm run live         # build + start server + open a public HTTPS tunnel, prints a URL
```

- Open the printed URL on your **laptop** → *Create room* → a QR appears.
- **Scan the QR with your phone** → join as Ben → *Join & enable sound*.
- Press **Start** — the agents talk it out; hold **🎤 Hold to talk** to jump in by voice.

**Pipeline (your keys, server-side only):** phone mic → **Whisper** (STT) → **chat LLM** →
**TTS** → audio. This sidesteps iOS Safari (which has no browser speech-to-text) and keeps
every key out of the browser. Voice defaults to **OpenAI TTS** (`nova`/`onyx`); set
`TTS_PROVIDER=elevenlabs` to use ElevenLabs instead. The deterministic room reducer still
owns the floor and suppresses acknowledgement loops — the whole thesis, but on real devices.

```
phone/laptop mic ─▶ /live (SSE + POST) ─▶ Whisper ─▶ LLM (room-aware) ─▶ TTS ─▶ audio
                          │
                          └── one shared roomState: goal · floor · turn · loopRisk
```

> The tunnel URL is **ephemeral** — it works only while `npm run live` and your laptop stay
> awake, and changes on restart. For a permanent host, point it at Convex + Vercel (roadmap).

Requires a gitignored `.env.local` with `OPENAI_API_KEY` (and optionally `ELEVENLABS_API_KEY`),
plus [`cloudflared`](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/).

---

## The UI

A dark **“observability console”** for watching the failure and the fix, side by side, live.

- **Live side-by-side streaming traces.** Press **Run** and both panels stream in turn-by-turn, in lockstep:
  - **Bad — No shared state** (red): three iPhones hear only each other’s audio → they loop on backchannels and never get past 1.
  - **Good — One shared room** (emerald): three iPhones + one authoritative room state + a scheduler → they count all the way up.
- **Live `roomState` inspector.** A syntax-highlighted, `● LIVE` JSON panel docked under the good trace, updating every turn (floor owner, next speaker, required act, counter, loop-risk) and flipping to `✓ COMPLETED` at the target.
- **Progress bar** with a glowing emerald fill and `current / target`.
- **Per-agent turn-taking.** `voice-a / voice-b / voice-c` are colour-coded (sky / violet / amber) so hand-offs are legible at a glance. The newest row fades in, is highlighted, and auto-scrolls into view.
- **Spoken narration.** The good run is read aloud with distinct Web Speech API voices per agent (with a watchdog so a flaky/backgrounded TTS engine can never hang the run).
- **NodeAgent mode.** A four-frame artifact chain (`context_bundle → grounded_answer → spreadsheet_delta → notebook_memo`) rendered as cards.
- **No API keys.** Model pickers, `N` (target), `Turns`, and an `Ollama` toggle live in the header. Ollama is optional.

---

## Quick start

```bash
npm install
npm run ui          # build the client + start the server
```

Open **http://localhost:8787** and click **Run the comparison**.

For UI development with hot reload:

```bash
npm run start       # terminal 1 — API + static server on :8787
npm run dev         # terminal 2 — Vite dev server on :5173 (proxies the API)
```

---

## Why this fixes the loop

**Bad architecture** — agents react to each other’s words:

```
Agent A audio → Agent B transcript → Agent B says "yeah exactly…"
Agent B audio → Agent C transcript → Agent C says "yep exactly…"
→ infinite acknowledgement loop
```

**Room-state architecture** — agents react to authoritative state:

```
utterance → speech-act classifier → room reducer → scheduler → next required act → agent output
```

The room state is the single source of truth:

```json
{
  "task": { "kind": "count_to_n", "target": 100, "current": 42, "next": 43, "completed": false },
  "floorOwner": "voice-c",
  "nextSpeaker": "voice-c",
  "nextRequiredAct": "task_action",
  "suppressAcknowledgements": true,
  "loopRisk": false
}
```

Backchannels like “yeah exactly” are classified, stored, and then **prevented from scheduling another acknowledgement**. The scheduler hands the floor to the next speaker and requires a `task_action` to advance.

### Real-world architecture

```
iPhone A (voice agent) ──┐
iPhone B (voice agent) ──┼──►  Shared live room  (WebSocket / LiveKit / backend)
iPhone C (voice agent) ──┘            │
                                      ├── roomState (authoritative)
                                      ├── scheduler (floor control)
                                      └── speech-act classifier
```

Each iPhone runs its own voice agent locally, but all three **join the same live room**. The room state is authoritative and lives on a shared server. The demo simulates that room on the server.

---

## Tech stack

- **React 19** + **Vite 8** — frontend SPA
- **Tailwind CSS v4** — theming via `@theme` design tokens in `src/client/index.css` (v4 does **not** auto-load `tailwind.config.js`, so the semantic tokens are wired in CSS)
- **shadcn-style primitives** — Button, Badge, Input, Select
- **react-o11y** (assistant-ui) — trace-tree rendering with `SpanPrimitive`
- **lucide-react** — icons · **Inter** + **JetBrains Mono** — typography
- **Web Speech API** — browser-native TTS, distinct voice per agent
- **tsx** — TypeScript server execution · **Vitest** — tests

---

## Roadmap — the Conductor Room

The demo simulates the room on one server. The product is a room that **real phones join**, so people don’t think about protocols.

**The honest boundary:** three iPhones running *closed, third-party* voice apps can’t silently share state — the OS sandboxes them and the only shared channel is sound. So the room can’t reach *inside* black-box agents; it coordinates *around* them (and *through* them once they integrate).

Three levels of solution quality:

| Level | Mode | Works with | Control | How agents get state |
|-------|------|-----------|---------|----------------------|
| 1 | **Acoustic conductor** (sidecar) | any black-box voice app | low | one host device listens, transcribes, shows/speaks the next cue |
| 2 | **User-mediated room** (QR/App Clip) | any app + a human relay | medium | each user joins a room and reads a per-turn script into their app |
| 3 | **Native integration** (MCP / SDK / API) | participating agents | high | agents read/write shared state directly |

Planned build order:

```
V1  QR room + browser clients · local Gemma/Qwen coordinator via Ollama · text-mode · side-by-side bad vs good
V2  Mic input + STT (whisper.cpp) · local TTS (Kokoro) · roomState inspector · three-phone LAN demo
V3  OpenAI Realtime / Gemini Live adapters · per-phone low-latency voice · room still owns floor + goal state
V4  MCP server / SDK · third-party agents join the room natively · multilingual STT/TTS
```

Architecture the roadmap converges on:

```
User-facing:     QR code / link / App Clip / web room  (tap → join → talk)
Realtime layer:  WebSocket / WebRTC / native Multipeer
Agent-facing:    MCP tools  (create_room, join_room, observe_room, claim_floor, commit_task_step, …)
Core:            room reducer + scheduler + task ledger  ← the source of truth
```

The engineering rule that holds at every level:

> **The voice agent may speak, but the room decides why, when, and what it is allowed to say.**

---

## CLI demos

```bash
npm run demo:compare                      # side-by-side bad/good step generator
COUNT_TARGET=30 npm run demo:voice        # voice agent loop
npm run demo:node -- "Build a local-first agent room"   # NodeAgent artifact chain
```

## Optional local LLM mode

Install [Ollama](https://ollama.ai), pull a model, and flip the toggle (or set env vars):

```bash
ollama pull gemma4:e2b            # edge voice / room-state default
ollama pull gemma4:12b            # stronger NodeAgent default

USE_OLLAMA=1 OLLAMA_MODEL=gemma4:e2b npm run demo:voice
USE_OLLAMA=1 OLLAMA_MODEL=gemma4:12b npm run demo:node
```

The deterministic state reducer keeps authority. The LLM phrases utterances/memos but cannot decide whether acknowledgement loops are valid.

## Local HTTP API

```bash
npm run start

curl http://localhost:8787/api/models
curl -X POST http://localhost:8787/compare/demo    -H 'content-type: application/json' -d '{"target":100,"turns":100}'
curl -X POST http://localhost:8787/voice/demo      -H 'content-type: application/json' -d '{"target":100,"turns":100}'
curl -X POST http://localhost:8787/nodeagents/run  -H 'content-type: application/json' -d '{"goal":"Build local room OS","model":"gemma4_12b"}'
```

---

## Project structure

```
src/
├── client/                         # React frontend (Vite-built)
│   ├── App.tsx                     # console shell, compare + node views, live streaming, roomState inspector
│   ├── index.css                   # Tailwind v4 @theme tokens + base styles
│   └── components/
│       ├── agents-ui/              # trace-tree-view, control bar, visualizer, indicator, transcript
│       └── ui/                     # Button, Badge, Input, Select
├── core/                           # types, speechActClassifier, roomReducer, guards — the heart of the system
├── compare/badGoodDemo.ts          # side-by-side bad/good step generator
├── voice/voiceAgent.ts             # voice agent loop
├── nodeagents/nodeAgentLocalMvp.ts # NodeAgent four-frame artifact chain
├── providers/localModels.ts        # local model catalog
└── server.ts                       # HTTP server (API + static)
```

## Commands

| Command | Description |
|---------|-------------|
| `npm run ui` | Build client + start server (http://localhost:8787) |
| `npm run dev` | Vite dev server with HMR |
| `npm run build` | Build client for production |
| `npm run start` | Start server only (serves `dist/`) |
| `npm test` | Run Vitest tests |
| `npm run check` / `check:client` | TypeScript type-check (server / client) |
| `npm run demo:compare` / `demo:voice` / `demo:node` | CLI demos |
