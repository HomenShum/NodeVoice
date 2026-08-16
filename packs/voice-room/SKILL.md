# Voice Room Coordination

Use the existing NodeVoice reducer and local NodeAgent loop as one bounded
capability. Do not copy or replace their implementations.

## Runtime bindings

- `src/core/roomReducer.ts` owns authoritative room state, task progress, floor
  selection, and acknowledgement-loop suppression.
- `src/voice/voiceAgent.ts` produces a deterministic next turn unless an
  optional provider is explicitly selected.
- `src/compare/badGoodDemo.ts` exercises the reducer-backed voice-room path and
  discloses whether text came from deterministic fixtures or a provider.
- `src/nodeagents/nodeAgentLocalMvp.ts` commits the context, answer, model delta,
  and memo artifacts into the same room-state model.

## Deterministic path

Run `npm run test:nodekit` for the focused no-key evaluation. It must prove that
the count advances exactly in order, the room completes at its target, the
reported provenance is deterministic, and the NodeAgent artifact sequence ends
in a completed task. This path must not require a cloud account or provider key.

## Boundary

The current runtime returns typed in-memory results and the CLI prints a human
readable summary. It does not write a canonical, content-addressed execution
receipt. Do not describe test output, `.nodeagent` compiler metadata, or console
logs as a proof receipt.
