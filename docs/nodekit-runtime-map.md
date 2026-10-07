# NodeKit map of the existing NodeVoice runtime

A developer extending a voice room needs to find the code that decides whether
an agent actually advanced the task. Follow [START_HERE.md](START_HERE.md) for
the running comparison, then use this map to locate the reducer and local
four-artifact loop. A logical map is useful for handoff; it does not replace
the runtime or turn old compiler output into proof of a current integration.

## Follow the code already in use

The root `nodeagent.yaml` declares one `nodeagent.application/v1` application
with `authoring.directory: ./src/nodeagents`. The `voice-room` pack describes
this existing seam:

1. `src/core/roomReducer.ts` owns task progress, floor selection and loop guards.
2. `src/voice/voiceAgent.ts` advances voice turns through that reducer.
3. `src/compare/badGoodDemo.ts` returns the comparison and its actual provenance.
4. `src/nodeagents/nodeAgentLocalMvp.ts` completes the context, answer, model
   delta and memo sequence using local room state.

Implementation stays at those paths. Current main's hosted Convex, local live
room and browser flows remain separate existing entry points; this pack maps
the local deterministic seam and does not migrate those flows.

The pack's tool/job/validator names are logical ownership labels, not registered
executable tools. The manifest's event/trace schema references are declared
targets. Current `RoomState`, `Utterance`, `Artifact`, comparison and local
NodeAgent results are repository-local types; this change does not make the
runtime emit `nodeagent.event/v1` or `nodeagent.trace/v1` envelopes.

## Check the mapped path without selecting a provider

After installing the repository's dependencies, use:

```bash
npm run test:nodekit
npm run doctor
npm test
npm run build
```

The focused alias selects the existing reducer, comparison and NodeAgent tests.
Their runtime calls explicitly disable Ollama or use the deterministic source;
they require no provider account or key. It is a subset, not a replacement for
the full suite, server/client/Convex typechecks, citation checks or build.
These commands are operator instructions, not a record that they passed on
this revision.

The manifest records the optional OpenAI/Ollama router because the application
schema requires provider references. It does not activate a provider. For the
CLI demo/proof path, use a fresh checkout and a clean shell without copied
private `.env.local` configuration or inherited `SOURCE`/`USE_OLLAMA` choices.
Those CLI paths can load local configuration; a configured provider run must
be evaluated separately from the focused no-key tests.

## Keep execution and receipt claims distinct

The mapped local functions return typed results in memory and print CLI
summaries. They do not write a canonical content-addressed execution receipt.
The unchanged `nodekit.yaml` remains `preview` with
`proof.receiptSchema: null`. Declared logical bindings, test output and compiled
composition metadata are not durable execution receipts or release acceptance.

## Historical compiler snapshot

The [five archived compiler files](evidence/nodekit-compiler-05b4e0e/) are copied
unchanged from [PR #4's July 20, 2026 branch](https://github.com/HomenShum/NodeVoice/tree/ee5e3f02dd206cce6658e9ec1274e3cbb5a009ee/.nodeagent).
That branch records compiler commit
[`05b4e0e`](https://github.com/HomenShum/NodeKit/commit/05b4e0e52623e3be14475ded96a7b7095548675d)
and its six-file discovery/hash. [The original factory PR](https://github.com/HomenShum/NodeKit/pull/4)
was closed without merging; its closure is not evidence of compiler acceptance.

The three discovered NodeAgent TypeScript files are unchanged in current main,
but the historical digests reflect CRLF bytes. Current NodeKit
[`a2d2e8ce`](https://github.com/HomenShum/NodeKit/blob/a2d2e8ce36cc3e87a6a8133469dd55d8b7580588/src/lib/agent-definition.mjs)
supports `authoring.directory`, normalizes text line endings and binds a broader
identity including source, tests, scripts and root package/lock files, and writes
additional identity outputs. Imported reducer/voice/comparison code has also evolved.
The old six-file hash cannot certify the current application.

The snapshots are archived under documentation rather than active
`.nodeagent` paths. No hashes were hand-edited or generated during this
reconciliation. Current compiler inspection, compilation and check are still
**NOT_RUN**. When those checks can be performed with an identified NodeKit
revision, generate fresh active output first, then check it:

```bash
node <NodeKit-checkout>/src/cli.mjs inspect --repo-root .
node <NodeKit-checkout>/src/cli.mjs compile --repo-root .
node <NodeKit-checkout>/src/cli.mjs compile --repo-root . --check
```

Current CI checks and compiler verification have different scope. Review
exact-revision evidence separately; no matched pipeline improvement, fresh
visual/SEO grade, provider behavior or production result is claimed here.
