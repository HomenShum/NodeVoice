# NodeKit brownfield runtime map

NodeVoice is mapped as a `nodeagent.application/v1` application without moving
or replacing its existing TypeScript runtime. The root `nodeagent.yaml` points
authoring at `src/nodeagents` and names the repo-local implementations that are
already used by the product and tests.

## Mapped slice

The single `voice-room` capability pack covers one coherent runtime seam:

1. `src/core/roomReducer.ts` owns task progress, floor selection, and loop
   guards.
2. `src/voice/voiceAgent.ts` advances deterministic voice turns through that
   reducer.
3. `src/compare/badGoodDemo.ts` exposes the deterministic room-state comparison
   and its provenance.
4. `src/nodeagents/nodeAgentLocalMvp.ts` commits the existing four-artifact work
   loop into the same room-state model.

The pack is a logical ownership map. Its implementation sources remain in place
and remain authoritative.

## Deterministic and no-key boundary

`npm run test:nodekit` runs the focused room reducer, deterministic comparison,
and local NodeAgent tests. These paths pass `useOllama: false` or select the
deterministic source explicitly, use repository fixtures, and require no API key
or external account. `npm run demo` remains the repository's disclosed no-key
comparison command.

The `provider` section in `nodeagent.yaml` records the real optional OpenAI and
Ollama router already present in the repository because the v1 application
schema requires a provider reference. The `deterministic-no-key` runtime profile
does not read `OPENAI_API_KEY` and does not make a provider call.

## Receipt boundary

NodeVoice currently returns `ComparisonResult` and `NodeAgentRunResult` values in
memory and prints CLI summaries. It does not persist a stable receipt envelope,
content hash, verifier result, or sanitized reproduction record. Therefore:

- `nodekit.yaml` intentionally keeps `proof.receiptSchema: null`;
- this mapping does not introduce a receipt schema;
- `.nodeagent` files are compiled composition metadata, not execution proof; and
- `npm run proof` is a useful local gate, but its success is not presented as a
  portable or release-ready receipt.

A future receipt can be declared only after the runtime itself writes and
verifies that artifact.

## Compiler dependency

The checked-in `.nodeagent` definition was generated with the NodeKit factory
work from [node-platform PR #4](https://github.com/HomenShum/node-platform/pull/4),
at compiler commit
[`05b4e0e`](https://github.com/HomenShum/node-platform/commit/05b4e0e52623e3be14475ded96a7b7095548675d).
That compiler follows the repository-relative `authoring.directory`, so the
discovery record content-binds all three existing `src/nodeagents` files as well
as this pack, skill, and evaluation binding. Earlier NodeKit drafts that scan
only fixed top-level directories cannot reproduce this definition.

The compiled hash covers the authored application directory and NodeKit
manifests. It is not a transitive TypeScript dependency graph, build attestation,
or execution receipt; the imported reducer, voice, comparison, and provider
implementations remain repo-local brownfield dependencies.

## Validation

```bash
npm run test:nodekit
npm run check
npm run check:client
npm run build
node <node-platform>/src/cli.mjs compile --repo-root .
node <node-platform>/src/cli.mjs compile --repo-root . --check
```
