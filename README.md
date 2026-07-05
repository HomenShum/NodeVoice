# Room OS — shared-state voice agents

> **Three friends walk down a street, each with an iPhone voice agent.** *“Count to 100 together.”*
>
> They didn’t fail for lack of intelligence. They failed for lack of **shared state**. The fix isn’t better agents — it’s a shared room.

A local-first demo that shows *why* multiple AI voice agents fall into never-ending “yeah, exactly…” acknowledgement loops — and proves the fix: a **server-authoritative room state** that agents read from and write to, instead of reacting to each other’s transcripts.

The one line that matters:

> **Physically in the same room is not the same as computationally in the same room.**

**▶ Try it live (no laptop needed): [room-os-live.vercel.app](https://room-os-live.vercel.app)** — frontend on Vercel, state + voice on Convex.

---

## Two ways to run the live room

| | Transport | Backend | Good for |
|---|---|---|---|
| **Local** (`npm run live`) | SSE + polling fallback, cloudflared tunnel | Node server on your laptop | fastest to hack, offline, on-site demo — laptop must stay awake |
| **Hosted** ([room-os-live.vercel.app](https://room-os-live.vercel.app)) | **fully reactive** — Convex WebSocket subscriptions (`useQuery`), zero polling | **Convex prod** (state + LLM/TTS actions + audio storage) + **Vercel** (frontend) | permanent URL, **laptop can sleep**, scales |

The same frontend serves both — transport is selected at build time ([`roomClient.ts`](src/client/live/roomClient.ts)):
`VITE_CONVEX_URL` set → the reactive Convex client (`useConvexRoom`); unset → the HTTP client
against the local Node server. See [Convex architecture](#convex--the-cloud-room-ledger) below.

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
> awake, and changes on restart. The **hosted** version ([room-os-live.vercel.app](https://room-os-live.vercel.app))
> has none of these limits — see below.

## Convex — the cloud room ledger

The hosted version makes **Convex the server-authoritative room-state ledger**, so the laptop is
out of the loop entirely. The mapping (the whole thesis in three primitives):

```
query    = reactive read / subscribe to room state + traces   (watchRoom, listTraces)
mutation = deterministic state transition — the reducer        (createRoom, submitHuman,
           lives here; the model is never trusted to coordinate  commitAgentTurn, setRunning)
action   = nondeterministic work: LLM / STT / TTS, commits      (runTurn, stepOnce,
           back through a mutation                                transcribeHuman)
```

```
 Laptop browser (Ada)                     iPhone browser (Ben)     ← both are just clients;
   create / join / step / run                join via QR             either can sleep
        │ useQuery(watchRoom) — WebSocket        │ (reactive subscription,
        │ useMutation / useAction                │  zero polling)
        └─────────────────────┬──────────────────┘
                              ▼
 ┌──────────────────────────  CONVEX  ──────────────────────────┐
 │ queries     watchRoom · listTraces        (reactive)         │
 │ mutations   reducer: floor / loop-guard / commit (bounded)   │
 │ actions     runTurn → OpenAI LLM + TTS → ctx.storage → commit│
 │ scheduler   ctx.scheduler hops (runToken cancels stale)      │
 │ storage     TTS mp3 (served by direct storage URLs)          │
 │ http.ts     /live/* bridge (+CORS) for non-React clients     │
 └──────────────────────────────────────────────────────────────┘
```

The hosted client subscribes with `useQuery(api.rooms.watchRoom)` — every server-side mutation
pushes the new snapshot to all devices over Convex's WebSocket. Measured on the deployed app:
**0 polling requests** across a full multi-turn run. The `http.ts` bridge stays for curl/scripts
and non-React clients.

Corrections baked in vs. a naive sketch: `commitAgentTurn` **advances state** (not just logs);
`traces`/`utterances` are **bounded** (agents amplify unbounded tables fast); auto-run is a
**durable scheduler hop chain** (pausable/restart-safe), not an in-action loop; TTS mp3 lives in
**Convex storage**; coordination stays in **mutations** so a slow/verbose model can't corrupt the
room.

### Deploying your own

```bash
# 1. Convex backend (dev for iteration, deploy for prod)
npx convex dev --once          # provision/push to your dev deployment
npx convex env set OPENAI_API_KEY <key>            # dev
npx convex deploy -y                                # push to PROD
npx convex env set OPENAI_API_KEY <key> --prod      # prod

# 2. Frontend → Vercel, pointed at the prod deployment
VITE_CONVEX_URL="https://<prod>.convex.cloud" \
VITE_LIVE_BASE="https://<prod>.convex.site" \
npx vite build --outDir ../../room-os-live --emptyOutDir
# add vercel.json (SPA rewrite) to the output dir, then:
cd room-os-live && vercel deploy --prod --yes
```

Requires a gitignored `.env.local` with `OPENAI_API_KEY` (and optionally `ELEVENLABS_API_KEY`),
plus [`cloudflared`](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/).

---

## Model router — measured, not guessed

The room's coordinator LLM is **swappable live** — a dropdown in the room header, or
`OPENAI_MODEL` at launch. The default (`gpt-5.4-mini`) and the ranking below come from an
empirical **proofloop** (`scripts/model-eval.mjs`): 6 models × 4 room scenarios
(planning-with-constraints, loop-trap, human-steer, convergence), each reply judged by
`gpt-5.4` on specificity / progress / non-looping / instruction-following / naturalness,
with latency + token cost measured per call.

![Model quality vs latency](docs/model-chart.svg)

| Model | Proofloop quality (1–5) | Latency (single turn) | $ / turn | Best for |
|---|---|---|---|---|
| **gpt-5.4-mini** · default | **4.75** | **1.3s** | $0.00072 | smartest mini that stays fast |
| gpt-4.1-nano | 4.15 | **0.7s** | **$0.000033** | cheapest + fastest |
| gpt-4.1-mini | 4.1 | 0.7s | $0.00014 | fast, balanced |
| gpt-4o-mini | 4.5 | 1.0s | $0.000051 | legacy baseline |
| gpt-5-nano | 4.6 | 3.2s | $0.00013 | cheap + smart, but slow |
| gpt-5-mini | 5.0 | 3.0s | $0.00079 | top quality — too slow for live voice |

**Takeaways:** these are all capable models, so quality clusters tightly (4.1–5.0) — the
decisive axes are **latency** and **cost**. `gpt-5-mini`/`nano` reason before answering
(~3s, 250-300 reasoning tokens); `gpt-5.4-mini` adaptively *skips* reasoning on simple turns
(~60 tokens, 1.3s) so it's the only "smartest-tier" model fast enough for a live loop.
Reproduce anytime: `node scripts/model-eval.mjs` → writes `docs/model-eval-results.json`.

## Realtime vs. this STT → LLM → TTS pipeline

Your key can run the **Realtime API** (`gpt-realtime`, `gpt-realtime-mini`) — speech-to-speech
over WebRTC. It's lower-latency and supports natural barge-in, but it's the wrong fit *here*:

| Dimension | Chained pipeline (this app) | OpenAI Realtime |
|---|---|---|
| Latency / turn | ~1.5–3s (STT + LLM + TTS) | ~0.3–0.8s (streamed) ✅ |
| Barge-in / interruption | turn-based | native ✅ |
| **Cost / minute** | **~$0.03–0.04** ✅ | **~$0.30** (`gpt-realtime`) |
| Intermediate text / room-state control | full ✅ (that's the whole thesis) | hidden inside the audio session |
| Loop-prevention + visible `roomState` | trivial ✅ | hard |
| Implementation | plain HTTP, no WebRTC ✅ | WebRTC + ephemeral tokens |

**Cost math** — `gpt-realtime` bills audio at **$32/1M in + $64/1M out** (~$0.06 + $0.24 per
minute ≈ **$0.30/min**). The pipeline's dominant cost is TTS (`gpt-4o-mini-tts` ~$12/1M audio
tokens ≈ **~$0.006/spoken turn**); STT (`whisper-1` $0.006/min, or `gpt-4o-mini-transcribe`
**$0.003/min**) only runs when *you* press-to-talk — the agents' words are generated text, never
transcribed. So the pipeline lands around **$0.03–0.04/min of conversation, ~8–10× cheaper**
than Realtime, while keeping the intermediate text the shared-room thesis depends on.

**Verdict:** stay on the chained pipeline for this turn-based, room-state-visible, cost-sensitive
demo. Realtime earns its price in a future *fluid, interruptible 1:1 voice* mode — not a
two-agent room you watch and steer.

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
