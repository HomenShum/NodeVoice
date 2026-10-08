# NodeVoice changelog

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
