# Pause before speech synthesis

A person running a local NodeVoice room can pause while an assistant is still
thinking, then continue with a manual turn. Previously the paused generation
started speech synthesis before checking its canceled loop token. The final
guard discarded that output, but the additional speech request was unnecessary.

The Node live server now checks its existing loop token and running state as
soon as generation returns. An obsolete auto-run turn stops before speech. The
post-synthesis check remains necessary because a pause can also arrive while
speech is already in flight. Manual steps have no loop token and remain usable.

## Reproduce without a provider

Run `npm test -- tests/liveCancellation.test.ts` in the normal installed repo.
The regression drives the actual HTTP handler and pipeline. Every provider
fetch is intercepted before importing them; a process-local synthetic key and
three fake audio bytes are fixtures, not generated speech or a quality sample.

The frozen before/after cases cover:

- Four rooms with pending generations, paused and then released together.
- Sixteen successive pause/recovery cycles in one room.
- Pause during synthesis, preserving the existing rejection of late output.
- A canceled generation failure followed by successful manual work.
- Failed primary and fallback speech requests with a usable text-only turn.

Against the original server, all 20 paused pending generations started one
speech request each. The same cases after the change start zero. All 22 manual
recovery controls publish exactly one new turn and expose retrievable fixture
audio. The already-started speech case still discards its canceled output; the
degraded manual turn still succeeds without audio. Manual-step admission is the
settlement barrier: only the exact HTTP 409 `room is busy` is retried, sequentially
and within a finite budget.

This is bounded scheduling and accumulated-state coverage, not a production
soak. It observes acknowledged in-memory pause state, not durable persistence.
It does not abort provider work already started, cancel the provider's internal
speech fallback, certify browser/hosted behavior, or cover the separate Convex
coordinator. The model-refresh branch and its pipeline, Convex and UI changes
are outside this patch. No framework, provider model or dependency changes.
