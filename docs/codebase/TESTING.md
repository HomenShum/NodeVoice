# Testing

## The commands

```bash
npm test        # vitest run --root .   → 8 files, 38 tests, ~11 s, no network
npm run doctor  # tsc --noEmit on all three projects (server, browser, Convex)
npm run build   # vite build → dist/
npm run proof   # npm test && npm run demo:compare
```

CI (`.github/workflows/ci.yml`) runs `npm ci`, both original typechecks,
`npm test`, and `npm run demo:compare` with `COUNT_TARGET=10`. **CI does not yet
run `npm run check:convex`** — see CONCERNS.md.

## What each file proves

| File | The claim it defends |
|---|---|
| `tests/countToOneHundred.test.ts` | The demo reaches 100 at the shipped defaults, and every number 1..100 survives a speak-then-hear round trip. This is the regression test for the defect that stalled the product's headline demo at 99 forever. |
| `tests/comparisonMvp.test.ts` | The shared-record room completes; the transcript-only room does not. |
| `tests/liveRoomSeats.test.ts` | A laptop creates a room over real HTTP and two devices join the *same* room, seated 1 and 2 with the names `src/core/agents.ts` assigns; the roster clamps at 100; an unknown room id is a 404. |
| `tests/liveSteering.test.ts` | The Convex backend and the Node server hold the **same** steering functions (asserted by object identity), and every count / goal / negation / interrogative / approval case parses as specified. |
| `tests/roomReducer.test.ts` | Progress is committed only for real progress. |
| `tests/badFooter.test.ts` | The transcript-only room fails in the designed way, not an accidental one. |
| `tests/openaiCompare.test.ts` | The prompts sent to OpenAI contain what the product claims they contain. |
| `tests/nodeAgentMvp.test.ts` | The NodeAgent loop produces artifacts. |

## How tests are written here

**Scenario first, unit second.** A test starts from a person and a goal — "a
laptop creates a room and a phone joins it" — and drives the real surface.
`tests/liveRoomSeats.test.ts` starts an actual `node:http` server on an
ephemeral port and speaks HTTP to it; there are no mocks anywhere in the suite.

**No keys, no network.** The default comparison source is `deterministic`, so
the whole suite runs offline. That is a deliberate product property, not just a
test convenience.

**A new test must be able to fail.** Before adding one, break the thing it
covers and watch it go red. `tests/liveRoomSeats.test.ts` was mutation-checked
this way: changing `device: index === 1 ? "laptop" : "phone"` to
`device: "phone"` in `src/core/agents.ts` turns it red, restoring it turns it
green. Record that check in the commit message; a test that has never failed has
not been shown to be a test.

## The browser half

Unit tests cannot see a clipped button or a progress bar that never moves. The
committed browser check is:

```bash
npm run build
PORT=4307 npx tsx src/server.ts &
npm i --no-save playwright && npx playwright install chromium
BASE_URL=http://127.0.0.1:4307 node scripts/prove-count-to-100.mjs
```

It drives the built client in headless Chromium, polls the rendered
SHARED-ROOM PROGRESS readout, writes a screenshot and 100 timed samples to
`promotion/evidence/`, and **exits non-zero if the rendered progress does not
reach 100**. Playwright is installed with `--no-save` on purpose so browser
binaries never enter `package.json` or CI install time.

Last run against this tree: rendered `100/100` after 131.4 s, `consoleErrors: []`,
`failedRequests: []`, exit 0 —
`promotion/evidence/wave-3/count-to-100-after-reduction.json`.

**Restart the server before capturing.** A process older than your change
produces evidence about a tree that no longer exists.

## Other scripts in `scripts/`

These are evidence producers, not application code, and knip is configured
(`knip.json`) to treat them as entry points so they are not reported as dead:

- `record-readme-hero.mjs` — records the README hero clip from the real
  quickstart path.
- `model-eval.mjs` — the empirical latency/cost/quality eval behind
  `src/core/routerModels.ts`. Its output is `docs/model-eval-results.json`.
- `generate-chart.mjs` — renders `docs/model-chart.svg` from that eval.
- `live.mjs` — one-command live deploy (`npm run live`).
