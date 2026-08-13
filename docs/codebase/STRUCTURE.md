# Structure

Every directory, what lives in it, and the one rule that keeps it that way.

    src/core/       The rules of a room. Runtime-agnostic, no I/O, no framework.
                    THE SINGLE COPY: imported by the Node server, by the hosted
                    Convex backend, and by the browser. If two runtimes must
                    agree on something, it belongs here.
                      agents.ts        seats, seat count, rotation, agent roster
                      steering.ts      "what did the human mean" → intent/goal
                      numberWords.ts   English numbers, both directions
                      routerModels.ts  the model table with measured cost/latency
                      roomReducer.ts   the shared record; the only place progress
                                       is committed
                      speechActClassifier.ts, types.ts, guards.ts, ids.ts

    src/live/       The local live room, over plain HTTP + Server-Sent Events.
                      roomServer.ts    handleLive() — every /live/* route
                      pipeline.ts      Whisper → LLM → TTS, all calls bounded

    src/compare/    The /demo comparison: two rooms, one difference.
                      badGoodDemo.ts   runSideBySideComparison()
                      badFooter.ts     the transcript-only room's failure summary

    src/voice/      One agent's turn in the demo room (runVoiceStep).
    src/nodeagents/ The NodeAgent tab: a goal → a plan → artifacts.
    src/providers/  Outbound model calls: openai.ts, ollama.ts, and
                    localModels.ts (the local-model catalogue behind /api/models).

    src/client/     The browser. Vite root; `@/` resolves to this directory.
                      App.tsx          the /demo page
                      live/LiveRoom.tsx the live-room page
                      live/roomClient.ts ONE decision: HTTP transport or Convex
                      live/useRoom.ts / useConvexRoom.ts the two transports
                      components/ui/   shadcn primitives (generated)
                      components/agents-ui/ trace tree, transcript, control bar

    src/server.ts   The Node entry point: static files + eight JSON routes.

    convex/         The hosted backend. rooms.ts (mutations/queries),
                    coordinator.ts (the turn scheduler and V3 workers),
                    openai.ts, http.ts (mirrors the /live/* API), schema.ts
                    (nine tables), shared.ts (Convex-specific glue only —
                    the room rules are imported from src/core/).

    tests/          Eight files. No mocks; the live-room test uses a real socket.
    scripts/        Evidence producers, not app code. See TESTING.md.
    promotion/      The product loop's scorecard, journeys and evidence.
    docs/           This packet, plus the model eval and architecture notes.

## The rule

**A thing that two runtimes must agree on lives in `src/core/` and is imported.**
Before Wave 3 the seat algebra existed three times and the steering parser
twice; a bug fixed in one copy stayed broken in the others, which is exactly how
the "count to 100" defect shipped. `tests/liveSteering.test.ts` now asserts by
identity that the Convex backend and the Node server hold the *same function
objects*, so a copy cannot quietly reappear.
