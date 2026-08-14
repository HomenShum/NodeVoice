# Architecture

## The one idea

Several talking assistants in the same conversation cannot finish a task
together by listening to each other, because speech is not a record. They finish
when there is **one shared piece of paper** every device reads and writes. In
this codebase that paper is `RoomState`, and the only thing allowed to write on
it is `src/core/roomReducer.ts:applyUtterance`.

Everything else is plumbing around that sentence.

## Three ways to run it, one set of rules

```
                       +------------------- src/core/ --------------------+
                       |  agents.ts   steering.ts   numberWords.ts        |
                       |  routerModels.ts   roomReducer.ts   types.ts     |
                       |  (no I/O, no framework, ONE copy)                |
                       +------+---------------+---------------+-----------+
                              |               |               |
            +-----------------+--+   +--------+--------+   +--+----------------+
            | /demo  (scripted)  |   | live room       |   | hosted            |
            | src/compare/       |   | src/live/       |   | convex/           |
            | src/voice/         |   | HTTP + SSE      |   | mutations + WS    |
            | in-memory, no keys |   | in-memory       |   | Convex tables     |
            +-----------------+--+   +--------+--------+   +--+----------------+
                              |               |               |
                              +---------------+---------------+
                                              |
                                   src/client/  (React)
                                   roomClient.ts picks the transport ONCE
```

**1. The demo (`/demo`).** No keys, no network, no database.
`runSideBySideComparison` runs the same task in two rooms — one that only has a
transcript, one that has the reducer — and returns both step lists. This is the
product's argument and the first thing to read.

**2. The live room (`npm run live`).** Real devices, real speech. `handleLive`
in `src/live/roomServer.ts` owns every `/live/*` route; rooms live in a module
`Map`, and state reaches browsers over Server-Sent Events with polling as a
fallback (which is what makes it work through a tunnel and on iOS Safari).
`src/live/pipeline.ts` does Whisper then LLM then TTS, every call behind an
`AbortController` budget with a size cap on the response body.

**3. The hosted deployment (`nodevoice.vercel.app`).** The same React client,
built with `VITE_CONVEX_URL` set. State lives in nine Convex tables
(`convex/schema.ts`), the scheduler runs as Convex actions
(`convex/coordinator.ts`), and the browser subscribes over a WebSocket instead
of polling. `convex/http.ts` mirrors the `/live/*` API shape so the client only
changes its base URL.

## The seam a reader should find first

`src/client/live/roomClient.ts` — twenty lines, one decision:

```ts
export const CONVEX_MODE = Boolean(import.meta.env.VITE_CONVEX_URL);
export const useRoom = CONVEX_MODE ? useConvexRoom : useHttpRoom;
```

It is a module-level constant, not a runtime branch, so hook order is stable for
the life of the app. Everything above this line is transport-agnostic;
everything below is one transport or the other.

**The two transports duplicate about 130 lines** (`useRoom.ts` /
`useConvexRoom.ts`), and that was left in place deliberately. They are genuinely
different mechanisms — `fetch` plus SSE versus Convex mutations plus a
subscription — and collapsing them means adding an adapter interface with
exactly two implementations. Deleting copy-paste by adding an abstraction is the
trade this codebase declines. See `docs/SIMPLIFICATION_REPORT.md`, unresolved
finding 2.

## Invariants

1. **Only the reducer commits progress.** `applyUtterance` returns a new state;
   nothing mutates `RoomState` in place, and `version` increments on every
   commit. Agreement, handoffs and congratulation are recorded and change
   nothing.
2. **A model never decides the count.** `decideVoiceUtterance` computes the
   correct deterministic answer first and only asks a model if the request said
   to; `enforceRoomPolicy` (`src/core/guards.ts`) blocks an off-task utterance
   and the room speaks the correct number anyway.
3. **The server owns the floor.** `scheduleNextSpeaker` decides who is next, not
   the agents. This is what stops the acknowledgement loop.
4. **Untrusted input is narrowed at the boundary.** `validProfile`,
   `validModel`, `validAgentCount`, `validCountTarget`, `validTurns` and the
   `source` narrowing in
   `src/server.ts:78 const source: ComparisonSource` each map anything
   unrecognised onto a safe default rather
   than passing it through. The two count fields are narrowed at the seam every
   caller shares rather than in each route: `validTurns` bounds a run by
   `MAX_RUN_TURNS`, the cap the live room already used, and `validCountTarget`
   bounds `task.target` by `MAX_COUNT_TARGET` inside
   `src/core/roomReducer.ts:8 export function createVoiceRoom` and
   `src/compare/badGoodDemo.ts:80 const target = validCountTarget`. A string
   reaching `task.target` used to make `current >= target` permanently false, so
   the room could never complete.
   Request bodies have ONE cap and TWO readers, one per stream type. The cap is
   `src/core/requestBody.ts:18 export const MAX_BODY_BYTES`, 20 MB, and it is
   imported by both readers rather than written down twice, because a cap that
   exists twice drifts. The readers are
   `src/live/roomServer.ts:679 export async function readJson` for the Node
   server's `node:http` stream, and
   `src/core/requestBody.ts:84 export async function readJsonRequest` for the
   web `Request` the Convex HTTP router hands its actions. Every POST route in
   both servers goes through one of them: the Node routes via `readJson`, and
   all four Convex registrations via the single
   `convex/http.ts:37 async function body` helper (plus
   `convex/http.ts:49 async function binaryBody` for the one audio route that
   takes bytes rather than JSON). They are two readers because a socket and a
   web stream refuse differently — over the cap the Node reader answers 413
   within `DRAIN_GRACE_MS` whether or not the client ever finishes uploading,
   since a refused request must not be able to hold a socket, while the web
   reader cancels the stream, which is that platform's way to say the same
   thing.

   That no THIRD reader appears is checked by walking `src/` and `convex/`, not
   by keeping a list of callers:
   `tests/p0Boundary.test.ts:90 finds no third request-body reader`. The walk
   covered `src/` only until an adversarial verifier pointed at `convex/http.ts`
   — a second complete implementation of the same public routes, whose every
   POST read its body with an uncapped `req.json()` while this paragraph claimed
   one reader with one cap. The detector missed it twice over: it also only knew
   the `.on("data")` and `for await` shapes, so a web-`Request` read was
   invisible to it. Both are fixed, and the fix was proved by adding a bypassing
   route and watching the guard fail. The Convex router also takes `validTurns`
   and `validCountTarget` from `convex/shared.ts` instead of the private
   `clampTarget` (2..300) / `clampTurns` (3..320) it used to carry, which were
   the same caps written a second time;
   `tests/p0Boundary.test.ts:162 hands the Convex router the same validators`
   asserts identical function objects and that the numbers are not restated.
5. **What two runtimes must agree on lives in `src/core/`.** Enforced by an
   identity assertion in `tests/liveSteering.test.ts`.
