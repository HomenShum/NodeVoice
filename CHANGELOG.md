# NodeVoice changelog

## 2026-10-14 — Remove the retired gpt-4.1-nano router row

OpenAI retires `gpt-4.1-nano` on 2026-10-23. The room model picker no longer
offers it, rooms that already stored it are rewritten to `gpt-5.4-mini` by
`rooms:migrateRetiredRoomModels` (audit rows in `roomModelMigrations`), and every
request the coordinator builds from `room.model` (the turn, the human-steer
interpreter, the planning-worker fallback) resolves it through `validModel`.
New planning workers also store `validModel(room.model)` at spawn, so a host
steer in a room that has not been migrated yet does not create a worker that
sends the retired id. `watchRoom` serializes `validModel(room.model)`, so until
the migration runs the picker and the cost panels show the model the coordinator
actually sends. `gpt-5-nano` / `gpt-5-mini` rows are marked "retires
2026-12-11" (in the dropdown options, not only the hover title) and are removed
in a follow-up PR through the same migration. The `gpt-5.4-mini` literals in
`src/live/pipeline.ts` and `src/providers/openai.ts` now import `DEFAULT_MODEL`. `scripts/model-eval.mjs` carries
`PRICING_AS_OF` (the date its per-M prices were typed, not re-verified). Spec:
model-defaults SPEC Part A section A.2 (NodeVoice).

**Planning workers.** Worker rows created BEFORE this change store `gpt-4.1-nano`
too, and `retryV3Worker` copies the stored model forward. `runV3Worker` resolves an
`execution_plan` row through `validModel(worker.model ?? room.model)`, so a retry
before the migration still requests `gpt-5.4-mini`; the stored rows would
nonetheless keep the retired id, so `rooms:migrateRetiredRoomModels` also
pages `workers` (`{"table":"workers"}`): `execution_plan` rows whose model is not
in `ROUTER_MODELS` become `gpt-5.4-mini` and get an audit row (`workerId` set).
`web_research` rows are never touched, so the `OPENAI_WEB_MODEL` caller argument
is preserved. Pages are 6 rows (`MIGRATION_PAGE_SIZE`): a room's `goal` has no length
cap, so a page of 1 MiB documents read twice (page, then `patch`) must stay under
Convex's 16 MiB per-mutation read limit and 8 MiB write limit. After the deploy run
`node scripts/migrate-retired-models.mjs --prod`, which walks every page of both tables
(a bare `npx convex run` targets the DEV deployment, so the script refuses to spawn unless
the arguments name a deployment: `--prod`, `--deployment-name`, `--preview-name`, or `--url`
with `--admin-key`; it also refuses while `CONVEX_DEPLOY_KEY` / `CONVEX_DEPLOYMENT_TOKEN` is set in the environment,
`.env.local` or `.env`, because the Convex CLI then ignores `--prod` and migrates the key's deployment, and it fails on the CLI's "Ignoring `--prod`" warning); run it again and expect `migrated: 0` for both tables. BEFORE the removing
deploy, record the running production rooms (`npx convex data rooms --prod --limit 1000`,
keep those with `running: true`; SPEC A.2.5: live rooms are checked before removal).

**Pricing sources (SPEC A.0.6).** The voice/Realtime unit prices at
`README.md:1206-1209` (`gpt-realtime`, `gpt-4o-mini-tts`, `whisper-1`,
`gpt-4o-mini-transcribe`) are as of 2026-07-04: typed in commit `40cd6b6`, the same
day as the router prices, and not re-read from the vendor since. They are not router
ids and the repo has no second source, so no agreement test covers them.

**Pricing agreement (SPEC A.0.6).** `ROUTER_PRICING_AS_OF` (2026-07-04) dates the
`expectedCostUsd` figures; a test recomputes every recorded call's cost from the
eval script's per-M table and checks it against `docs/model-eval-results.json` and
`ROUTER_MODELS`. A second test reads the README `$/turn` table and the
`scripts/generate-chart.mjs` DATA rows (both frozen, read-only) and checks each
against `byModel.costPerTurn` at the 2 significant figures they print.

**Validation:** `tests/roomModelMigration.test.ts` (22 tests) fails on the
previous code (request carried `gpt-4.1-nano`) and passes now, with one
request-shape test per changed coordinator role (turn, steer interpreter,
planning worker spawned through the real steer path). `completeV3Worker` no
longer writes a model outside `ROUTER_MODELS` onto an `execution_plan` row, so an
in-flight planning call cannot undo the workers migration by echoing the retired
id back. `npm run check`,
`check:client`, `check:convex`, `check:citations` and `npm test` pass. No
provider calls made.

## 2026-10-07 — Make setup and proof limits reachable

Developers and coding agents can reach the existing `HANDOFF.md` from the README
starting point beside the current runtime map. `docs/START_HERE.md` directs them
to exact-revision evidence instead of presenting the old eight-file, 38-test
count as the current full-suite result. The `npm test` command is unchanged.

**Before:** main `6c64fa1b88b821e8a208d832b7693dfd72d5ae2d` had no README
handoff link and retained the stale suite description in the walkthrough.
**After:** this documentation-only candidate preserves the runtime, tests,
dependencies, historical evidence and all other source text.
**Validation:** pinned source and manifest readback only. Application execution,
fresh CI, visual/SEO grading, providers and production verification are NOT_RUN
in this documentation pass; no pipeline-performance improvement is claimed.

## 2026-10-07 — Reconcile the NodeKit handoff with the current runtime

Developers and coding agents can follow the existing room reducer and local
four-artifact loop through `docs/nodekit-runtime-map.md`, linked beside the
README developer entry point. Add the focused `test:nodekit` alias while retaining
current dependencies, lock, full tests, doctor checks, runtime, UI and CI.

Keep the authored application, pack, skill and evaluation declarations. Describe
their schema targets and logical names honestly: they do not register tools,
emit versioned NodeAgent envelopes or create a durable execution receipt.
Archive the five July compiler files unchanged under
`docs/evidence/nodekit-compiler-05b4e0e/`, preserving their provenance while
removing stale outputs from the active `.nodeagent` location.

**Source before:** PR #4 `ee5e3f02`, 27 commits behind current main `05eb284e`.
**Source after:** this ordinary reconciliation, retaining both histories.
**Validation before the CSS test correction:** head `0d37917d` passed server/client/Convex
checks, build and 56 citations; tests passed 59/60. The selector accepted the first
stylesheet without an origin constraint. CI failed on an external CSS fetch; the
template includes Google Fonts, making font selection the supported inference.
The built href was not captured. The test now selects all same-origin stylesheets,
requires at least one, and retains 200/type/body assertions. Product HTML,
CSS and font delivery are unchanged; external font availability is not certified.
**Validation after:** exact-head automatic CI pending at publication; local execution
and current compiler regeneration/check NOT_RUN under retained execution holds.
Historical July checks are not current acceptance. No matched architecture
comparison, visual/SEO grade or production change is claimed.

## 2026-10-08 — Refresh one transitive source-map dependency

A developer using the retained NodeVoice toolchain now gets a lock that selects source-map-js 1.2.2 instead of 1.2.1. The pinned main `08eddca3825328541d09e3bd3c06b60b968c3bba` lock audit reported one high [indexed source-map denial-of-service advisory](https://github.com/advisories/GHSA-68fv-2mgg-jv7q). Its existing PostCSS and Tailwind parent ranges both permit the patched release.

**Change:** normal `npm update source-map-js --package-lock-only` changed only that leaf's version, registry URL and integrity. All 191 lock entry paths remain; the other 190 dependency records (including the root), parent ranges and `package.json` are unchanged.

**Local proof:** `NODEVOICE-ONE-TRANSITIVE-AUDIT-FIX-01` passed the complete lock comparison and a normal `npm audit --package-lock-only --json` with zero findings. The resolved target matches official registry metadata. This is a lock-only result, not an installed-tree audit or a full security certificate.

**Not run in this slice:** dependency install, tests, typechecks, build, browser, providers and deployment. The earlier [CI job for `08eddca`](https://github.com/HomenShum/NodeVoice/actions/runs/37660764318/job/112927394999) describes that earlier source, not this patched lock. At this local capture, new exact-head CI and runtime compatibility are NOT_RUN and remain required before merge. No product, pixel or production readiness is certified.
