# NodeVoice changelog

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
