# Trace observability — 2026-10-14

A visitor following a narrated comparison needs the current turn in view, and
an agent inspecting a rejected request needs a failed trace rather than a
completed one.

Before, the parent's scroll effect could run before the SDK mounted the active
row. An inline row component also replaced existing DOM on parent updates, and
the step converter marked error events completed. Importing the old trace SDK
for server rendering left a referenced MessagePort after rendering and cleanup.

After, the row owns its scroll effect, the SDK's existing render-function API
preserves row identity, and error speech acts produce failed spans. The provider
uses the supported `AuiConfig`/`config` API. Exact direct versions are
`@assistant-ui/react-o11y` 0.0.47 and `@assistant-ui/store` 0.3.20, with tap
0.9.23 and the required Radix closure. Unrelated package records are unchanged.

Validation: clean install, installed dependency tree, `npm run doctor`,
`npm run build`, all 61 tests, deterministic 100-turn comparison, and full and
production dependency audits pass. The trace regression performs 55 real SSR
renders, including a rejected request, hostile text, empty/replacement data and
two independent 100-turn panes, then requires natural subprocess exit. Browser
checks separately cover native scrolling, stable row identity, rejected-request
recovery and bounded lifecycle behavior; SSR does not prove browser effects.

Delivery cost: JavaScript grows from 121,156 to 126,192 gzip bytes (level 9);
CSS is byte-identical. Three local production-harness runs measured 11,863.7 ms
total update-to-DOM wall time versus 8,775.1 ms for the broken-scroll baseline
and 11,216.2 ms for the old SDK with scrolling restored. Those ordered runs
include frame waits and DOM checks, so they do not establish a stable speedup,
CPU cost, INP or field performance.

The existing 390px mobile layout still leaves only 20px trace viewports; this
change does not certify responsive design. Synthetic comparison text and its
illustrative 500ms span timings do not measure model quality or voice latency.
Provider/model behavior, public APIs and CSS are unchanged. Local checks do not
certify production deployment or unlimited memory safety.
