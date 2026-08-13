# START HERE — one user action, followed through the code in the order it runs

This is not an architecture essay. It follows a single real thing a person does,
in the order the machine actually does it, so you can put a breakpoint anywhere
and know what you are looking at.

**The person and the job.** Someone has just watched three phones with three
voice assistants fail to count to ten together. They want to know whether that
is a model problem or a plumbing problem. They open NodeVoice, land on `/demo`,
and press **Run the comparison**. Two rooms run side by side: on the left,
assistants that only hear each other talk; on the right, assistants that all
read and write one shared record. The left room stalls. The right room reaches
100. That is the action this document follows.

## Run it first

```bash
npm install
npm run build          # builds the browser client into dist/
npm start              # serves dist/ + the API on http://localhost:8787
```

Open `http://localhost:8787/demo` and press **Run the comparison**. No API key
is needed: the default source is `deterministic`, which is scripted, not a
model. `npm test` runs the whole suite; `npm run doctor` typechecks all three
TypeScript projects (server, browser, Convex).

Two other entry points exist and are covered in
[docs/codebase/ARCHITECTURE.md](codebase/ARCHITECTURE.md): the **live room**
(real devices, real speech) and the **hosted** deployment (same client, Convex
backend). The steps below are the demo path, which is the one every reader
should trace first.

---

## Step 1 — The application starts and the page is served

**File:** `src/server.ts`
**Symbol:** `server` (the `createServer` callback) and `serveStatic`
**Called by:** `npm start` / `npm run ui`
**Calls next:** `handleLive` (live-room paths only), then the route table below

**Why this exists**
One small Node HTTP server does two jobs: it hands the browser the built client
out of `dist/`, and it answers the handful of JSON routes that client calls.
There is no framework and no second server. There is also exactly ONE browser
client — if `dist/` is missing the server says so on startup instead of quietly
serving something else.

**Core code**
```ts
const staticDir = resolve(fileURLToPath(new URL("../dist", import.meta.url)));

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", "http://localhost");
  if (await handleLive(req, res, url.pathname)) return;
  // …/health, /api/models, /compare/demo, /voice/demo, /nodeagents/run…
  if (req.method === "GET") return serveStatic(url.pathname, res);
});
```

**Input** — an HTTP request.
**Output** — a file from `dist/`, or JSON.
**Failure behavior** — unknown GET paths fall back to `index.html` so deep links
survive a reload; if `dist/` does not exist the response is
`{"ok":false,"error":"client_not_built"}` with the command to fix it.
**Next** — the browser boots in Step 2.

---

## Step 2 — The browser boots and the person presses the button

**File:** `src/client/main.tsx`, then `src/client/App.tsx`
**Symbol:** `App` → `runCompare` (`src/client/App.tsx:156 async function runCompare()`)
**Called by:** the **Run the comparison** button (`src/client/App.tsx:897 function CompareHero`)
**Calls next:** `POST /compare/demo`

**Why this exists**
This is the only place the demo's inputs — how high to count, how many turns to
allow, and whether to use a scripted script, a local model, or OpenAI — turn
into a request. `main.tsx` wraps the app in a Convex provider *only* when
`VITE_CONVEX_URL` is set at build time; with it unset (the default, and what
`npm start` gives you) nothing about Convex is loaded.

**Core code**
```tsx
const res = await fetch(demoApi("/compare/demo"), {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ target, turns, source: requestedSource, useOllama: requestedSource === "ollama", model: voiceModelId }),
});
```

**Input** — React state: `target` (default 100), `turns` (100), `source`.
**Output** — a `fetch` in flight; the button shows "Simulating room…".
**Failure behavior** — the `catch` around this call renders the error as a step
in the transcript (Step 8), so a missing key is visible, not silent.
**Next** — the request arrives at the server in Step 3.

---

## Step 3 — The request is checked before anything runs

**File:** `src/server.ts:67 path === "/compare/demo"`
**Symbol:** the `POST /compare/demo` branch, and the `source` narrowing below it
(`src/server.ts:76 const source: ComparisonSource`)
**Called by:** `runCompare`
**Calls next:** `runSideBySideComparison`

**Why this exists**
This is where a request stops being something a browser said and becomes
something the system will act on. The `source` field is narrowed to the three
values the code understands — anything else silently becomes `deterministic`
rather than reaching a provider — and asking for OpenAI without a server key is
refused here with a 400 that says exactly what is missing, before any work
starts.

**Core code**
```ts
const source: ComparisonSource =
  body.source === "openai" || body.source === "ollama" || body.source === "deterministic"
    ? body.source
    : body.useOllama ? "ollama" : "deterministic";
if (source === "openai" && !process.env.OPENAI_API_KEY) {
  return json(res, 400, { ok: false, error: "openai source requested but OPENAI_API_KEY is not set in .env.local on the server" });
}
```

**Input** — an untrusted JSON body.
**Output** — a validated `ComparisonSource` and a model id passed through
`getOllamaModelName` (`src/providers/localModels.ts`), which also refuses
unknown ids.
**Failure behavior** — HTTP 400 with a named cause; nothing has been mutated.
**Domain types** — `src/core/types.ts` holds `RoomState`, `Utterance`,
`SpeechAct` and the task shape everything below agrees on.
**Next** — orchestration in Step 4.

---

## Step 4 — Two rooms are run against each other

**File:** `src/compare/badGoodDemo.ts:58 export async function runSideBySideComparison`
**Symbol:** `runSideBySideComparison`
**Called by:** the `/compare/demo` route
**Calls next:** `runBadTranscriptLoop` (left room) and `runGoodRoomStateLoop`
(right room)

**Why this exists**
This is the product's argument, executed. The same task is given to two rooms
that differ in exactly one thing: whether a shared record of progress exists.
The left room's agents keep private beliefs and only hear speech; the right
room's agents all read and write one `RoomState`. Nothing else is changed
between them, which is what makes the comparison honest.

**Core code**
```ts
export async function runSideBySideComparison(options: { target?: number; turns?: number; source?: ComparisonSource; … }) {
  const bad = await runBadTranscriptLoop(turns);          // transcript only
  const good = await runGoodRoomStateLoop({ target, turns, … }); // shared record
  return { bad, good, badFinalState, goodFinalState, provenance };
}
```

**Input** — validated options.
**Output** — two step lists plus both final states and a `provenance` record
saying which source produced the text.
**Failure behavior** — a provider error propagates to the route's `try/catch`
and becomes an HTTP 500 with the message; no partial result is presented as a
success.
**Next** — each turn of the right-hand room goes through Step 5.

---

## Step 5 — An agent takes one turn, and a model is (optionally) called

**File:** `src/voice/voiceAgent.ts:60 export async function runVoiceStep`
**Symbol:** `runVoiceStep` → `decideVoiceUtterance` → `openaiChat` / `ollamaChat`
**Called by:** `runGoodRoomStateLoop`
**Calls next:** `enforceRoomPolicy` (`src/core/guards.ts`), then
`applyUtterance`

**Why this exists**
NodeVoice has no tool registry; what it has instead is a small set of
**providers** that are chosen per request, and a policy guard that runs on
whatever they return. `decideVoiceUtterance` always computes the correct
deterministic answer first, then only asks a model if the request said to. If
the model wanders, `enforceRoomPolicy` blocks the utterance and the room speaks
the correct number anyway.

*(The live room and the hosted backend do have a registry of background workers
— `runPlanningWorker` and `runWebResearchWorker`, dispatched by
`convex/coordinator.ts:151 runV3Worker`. That is a different flow; see
[ARCHITECTURE.md](codebase/ARCHITECTURE.md).)*

**Core code**
```ts
export async function runVoiceStep(state: RoomState, config: VoiceAgentConfig): Promise<RoomState> {
  const rawDecision = await decideVoiceUtterance(state, config);
  const decision = enforceRoomPolicy(state, rawDecision);
  const text = decision.blocked && state.task.kind === "count_to_n" ? numberToWords(state.task.next) : decision.text;
  return applyUtterance(state, { id: nextId("utt"), actorId: config.actorId, text, ts: Date.now() });
}
```

**Input** — the current `RoomState` and which agent is speaking.
**Output** — the next `RoomState`.
**Failure behavior** — Ollama unreachable falls back to the deterministic
answer (`isOllamaAvailable()` answers within 800 ms); an OpenAI failure throws
and surfaces in Step 8.
**Next** — the utterance is committed in Step 6.

---

## Step 6 — The shared record is updated. This is the product.

**File:** `src/core/roomReducer.ts:47 export function applyUtterance`
**Symbol:** `applyUtterance` → `classifyUtterance` → `applyTaskMutation`
**Called by:** `runVoiceStep`, and every live-room turn
**Calls next:** `applyLoopGuard`, `scheduleNextSpeaker`

**Why this exists**
Speaking is not progress. A turn only advances the count if the reducer decides
it did. `classifyUtterance` (`src/core/speechActClassifier.ts`) reads what was
said, `extractNumber` (`src/core/numberWords.ts`) works out which number that
was, and `applyTaskMutation` commits it only if it is the number the room was
waiting for. Everything else — agreement, handoffs, congratulation — leaves the
count exactly where it was. That is why the left-hand room stalls and the right
one does not.

**Core code**
```ts
export function applyUtterance(state: RoomState, utterance: Utterance): RoomState {
  const classified = classifyUtterance(utterance, state);
  const next = { ...state, utterances: [...state.utterances, classified], version: state.version + 1 };
  return scheduleNextSpeaker(applyLoopGuard(applyTaskMutation(next, classified)), classified.actorId);
}
```

**Input** — a state and one raw utterance.
**Output** — a NEW state (nothing is mutated in place) with `version` bumped,
the task advanced or not, and the next speaker chosen.
**Failure behavior** — an unparseable or wrong utterance is recorded but does
not advance the task, and the room asks for a correction. It cannot skip a
number, and it cannot finish early.
**Watch out** — `extractNumber` reads a whole phrase, not the first word.
"One hundred" is two tokens; returning on the first one used to make the room
hear `1`, ask for a correction, and stall at 99 forever. That defect is the
reason `tests/countToOneHundred.test.ts` exists.
**Next** — the finished run is rendered in Step 7.

---

## Step 7 — Progress reaches the screen

**File:** `src/client/App.tsx`
**Symbol:** `speakGoodSteps` (`src/client/App.tsx:192 async function speakGoodSteps`),
`CompareView` (`src/client/App.tsx:437 function CompareView`),
`RoomStatePanel` (`src/client/App.tsx:748 function RoomStatePanel`),
`AgentPrivateStatePanel` (`src/client/App.tsx:815 function AgentPrivateStatePanel`)
**Called by:** `runCompare`, after the response arrives
**Calls next:** browser `speechSynthesis`

**Why this exists**
The comparison is played back one turn at a time rather than dumped, because the
point is watching the right-hand counter climb while the left-hand agents'
private beliefs stay wrong. `RoomStatePanel` renders the shared record;
`AgentPrivateStatePanel` renders what each transcript-only agent *believes*.

**Core code**
```tsx
async function speakGoodSteps(steps: CompareStep[]) {
  const synth = window.speechSynthesis;
  if (!synth) { setAgentState("listening"); return; }   // no voice → still renders
  …
}
```

**Input** — the two step lists from Step 4.
**Output** — the played-back walkthrough and the two state panels.
**Failure behavior** — a browser with no speech synthesis renders everything
and skips the audio.
**Live rooms stream instead** — `src/live/roomServer.ts` pushes state over
Server-Sent Events (`GET /live/rooms/:id/events`), with polling as a fallback;
the hosted build gets the same state over a Convex WebSocket subscription
(`src/client/live/useConvexRoom.ts`). Which one the browser uses is decided once
at build time in `src/client/live/roomClient.ts`.
**Next** — failure handling, Step 8.

---

## Step 8 — When something fails, the room says so

**File:** `src/client/App.tsx` (the `catch` in `runCompare`),
`src/live/pipeline.ts:52 function keyOrThrow`,
`src/live/pipeline.ts:58 async function withTimeout`
**Symbol:** `keyOrThrow`, `withTimeout`
**Called by:** every outbound model / speech call
**Calls next:** nothing — these are the edges

**Why this exists**
A voice room that fails silently is worse than one that stops, because the
person cannot tell the difference between "thinking" and "broken". Every
external call is bounded by an `AbortController` budget and every response body
is size-capped, and a missing key produces a named error rather than an empty
turn.

**Core code**
```ts
function keyOrThrow(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is not configured on the server`);
  return v;
}
```

**Input** — a failing call.
**Output** — an error step in the transcript ("turn failed: Error:
OPENAI_API_KEY is not configured on the server") and, in a live room, an
"Auto-run halted on error" row in the trace inspector.
**Failure behavior** — the run stops; no fake success is recorded, and no
partial state is committed.
**Next** — the tests that hold all of this in place, Step 9.

---

## Step 9 — The tests that prove this flow

**File:** `tests/`
**Command:** `npm test` — 8 files, 38 tests, no network, no keys

| What it proves | File |
|---|---|
| The demo reaches 100 at the shipped defaults; 1..100 survives a speak→hear round trip | `tests/countToOneHundred.test.ts` |
| The side-by-side comparison ends with the shared room complete and the transcript-only room stuck | `tests/comparisonMvp.test.ts` |
| A laptop creates a room and a phone joins the SAME room, seats and rotation from `src/core/agents.ts`, over real HTTP | `tests/liveRoomSeats.test.ts` |
| One steering parser serves both backends (identical function objects), plus every count/goal/intent case | `tests/liveSteering.test.ts` |
| The reducer commits progress only for real progress | `tests/roomReducer.test.ts` |
| The transcript-only room's failure is the *designed* failure, not a bug | `tests/badFooter.test.ts` |
| The prompts sent to OpenAI say what they claim to | `tests/openaiCompare.test.ts` |
| The NodeAgent loop produces artifacts | `tests/nodeAgentMvp.test.ts` |

The browser half is `scripts/prove-count-to-100.mjs`: it drives the built client
in headless Chromium and exits non-zero unless the rendered progress reaches
100. Run it against a server you started yourself:

```bash
npm run build && PORT=4307 npx tsx src/server.ts &
npm i --no-save playwright && npx playwright install chromium
BASE_URL=http://127.0.0.1:4307 node scripts/prove-count-to-100.mjs
```

---

## Where you would add the next thing

- **A new kind of room task** (not counting) — `src/core/types.ts` for the task
  shape, `src/core/roomReducer.ts:applyTaskMutation` for what counts as
  progress, `src/core/steering.ts` for how a human asks for it.
- **A new way to steer a room in words** — `src/core/steering.ts` only. Both
  backends import that one file; there is no second copy to update.
- **A new model** — `src/core/routerModels.ts` (one table, both backends).
- **A new live-room HTTP route** — `src/live/roomServer.ts:handleLive`, and its
  Convex twin `convex/http.ts`.
