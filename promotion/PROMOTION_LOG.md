# Promotion log — NodeVoice

Loop state lives here, in git, so any agent can resume cold. One entry per
iteration. Append; never rewrite history, because the list of things that turned
out to be wrong is more useful to the next reader than the current values alone.

Iteration cap: **10** (default). On reaching the cap without a gate pass, stop
and leave the remaining defect ledger below — a documented stop is a valid
outcome; a silent one is not.

## Entry shape

```
### Iteration N — YYYY-MM-DD
- Journey exercised: J<k> <name>
- Observed: <the defect, with its reproduction — inputs, width, state>
- Fixed: <the change, using existing components; file paths>
- Re-proved: <evidence path showing the defect gone in the rendered app>
- Tests: <command and result>
- Conditions newly PASS: <numbers, or "none">
```

---

## Baseline — 2026-08-13

Commit `06b4198`, fresh clone, Windows 11 / Node 22.22.2. Wave 1 is measurement
only: **nothing in the product was changed.** Not marked DEFERRED in the wave
brief.

- **App started: yes.** `npm install` (246 packages, exit 0) → `npm run build`
  (exit 0) → `npx tsx src/server.ts`. The documented `npm run ui` binds 8787,
  which was already occupied by an unrelated process on this machine
  (`EADDRINUSE`); rather than capture evidence from a server I did not start, the
  run used `PORT=8791`. `/health` returned
  `{"ok":true,"service":"nodevoice","live":{"openai":false,"elevenlabs":false}}`.
- **Journeys drivable: 5 of 5.** All five reach the rendered app and can be
  driven end to end; **4 of 5 reach their done-when.** J1 does not (D1).
- **Browser driver:** headless Chromium via Playwright, three passes, scripts in
  the session scratchpad; every screenshot and both `findings*.json` files are
  committed under `promotion/evidence/baseline/`.
- **Not attempted, on purpose:** no cloud deploy, no publish, no secrets created
  or rotated. `nodevoice.vercel.app` was not exercised — the hosted build takes a
  different code path (`CONVEX_MODE`) and asserting anything about it from a
  local run would be a claim, not a measurement.
- Scorecard at baseline: see [PRODUCT_GOAL.md](PRODUCT_GOAL.md) — **5/12 PASS**,
  4 FAIL, 3 UNVERIFIED.

### Commands run, with real exit codes

| Command | Exit | Note |
|---|---|---|
| `git clone --depth 50 …/NodeVoice.git` | 0 | commit `06b4198` |
| `npm install --no-audit --no-fund` | 0 | 246 packages, ~2 min |
| `npm test` (`vitest run --root .`) | 0 | 6 files, 32 tests passed, 35.7 s |
| `npm run build` (`vite build`) | 0 | 1936 modules, `dist/` 384 kB js / 79 kB css |
| `npm run doctor` (`tsc --noEmit` ×2) | 0 | server + client projects clean |
| `npx tsx src/server.ts` (default PORT 8787) | 1 | `EADDRINUSE :::8787` — port held by an unrelated pre-existing process, not a repo defect |
| `PORT=8791 npx tsx src/server.ts` | running | served the freshly built `dist/` for every capture |
| `curl -X POST /compare/demo {"target":100,"turns":100,"source":"deterministic"}` | 0 | HTTP 200 in 13.8 ms; **`goodFinalState.task.completed === false`, `current: 99`** |
| `curl … {"target":100,"turns":101}` | 0 | HTTP 200; still `current: 99`, `completed: false` — not a turn-budget shortfall |
| `node drive-baseline.mjs` (Playwright) | 0 | lobby, overflow ×5, keyboard, `/demo` run, room create |
| `node drive-baseline2.mjs` (Playwright) | 0 | demo to 99/100 in 201.7 s, Start-with-no-key, steer, State drawer, mobile clip |
| `node demo-timing.mjs` (Playwright) | 0 | polled 2 s × 160: 25/100 @ 28 s, 50/100 @ 61 s, 99/100 @ 125 s, **100/100 never, to 322 s** |
| `node drive-join.mjs` / `drive-join2.mjs` | 0 | two contexts (1280 + 390) joined room `10e27b`, `ERRORS: []` |

## Defect ledger

Open defects, most-impactful first. A defect is only listed once it has a
reproduction; a hunch is not a defect.

| # | Severity | Journey | Reproduction | Status |
|---|----------|---------|--------------|--------|
| D1 | Critical | J1 | The demo that carries the product's headline claim can never reach 100. **UI:** `/demo` → **Run the comparison** at defaults (N 100, TURNS 100, SOURCE Sim, 1280×800). SHARED-ROOM PROGRESS reaches `99/100` at 125 s and never changes; polled every 2 s to 322 s. **API:** `POST /compare/demo {"target":100,"turns":100,"source":"deterministic"}` → HTTP 200, last good step `{"turn":100,"text":"One hundred","current":99,"next":100}`, `goodFinalState.task.completed === false`, `requiredNextAct: "correction"`. Raising `turns` to 101 does not help — same `current: 99`. **Root cause:** `src/core/numberWords.ts:extractNumber` scans tokens left to right and returns on the first small-number word, so `extractNumber("One hundred")` returns **1** (measured directly via `tsx`; `"Ninety nine"` → 99, `"100"` → 100 both correct). The reducer expects 100, receives 1, rejects the utterance and asks for a correction, so the shared room stalls one short forever while the pane still asserts "3 iPhones + 1 shared room + scheduler = count to 100". | **CLOSED — iteration 1** |
| D2 | Major | J2/J3 | At 390×844 in a live room, the header's action group (`div.ml-auto.flex.items-center.gap-2`) ends at x=399 against a 390 px viewport, clipping the **Invite** button (measured right edge 399, width 73). The document does not scroll horizontally, so the control is simply cut off with no way to reach it. Reproduce: create a room, set viewport 390×844. Capture: `evidence/baseline/10-room-mobile-390.png`, `16-room-mobile-header-clip.png`; measurement in `findings-pass2.json` → `mobileClip`. | OPEN |
| D3 | Minor | J2 | Two form controls have no programmatic label: the "Shared goal" textarea (its `<label>` is a sibling with neither `for` nor a wrapping relationship) and the join-code input (`placeholder="e.g. x7k2mp"` only). A screen-reader user tabbing the lobby hears an unnamed text field twice. Measured in-page over `input,textarea,select`; `findings.json` → `a11y.audit.inputsNoLabel`. | OPEN |
| D4 | Minor | J1 | README promises "**Quickstart (30 seconds)** … click **Run the comparison**", but the visible walkthrough is paced at roughly one turn per 1.25 s and takes 125 s to reach its (stalled) end state. The API itself answers in 13.8 ms — this is presentation pacing, not compute. A stranger following the README waits four times longer than promised for a result that never completes. | OPEN |

### Verified working, so a later wave does not "fix" it twice

- Console and network are clean across every journey: `console: []`,
  `failedRequests: []` in both findings files, `ERRORS: []` on the join pass.
- No horizontal document overflow at 390 / 768 / 1280 on lobby, `/demo`, room.
- The honest-failure path is genuinely good: missing `OPENAI_API_KEY` produces a
  named error and an explicit "Auto-run halted on error" trace row rather than a
  silent no-op or a fake success.
- The State drawer (reducer JSON + timestamped Trace Inspector) is the strongest
  surface in the product and needs no work to satisfy the receipt journey.

## Iterations

### Iteration 1 — 2026-08-13

- **Journey exercised:** J1 "Show me that the shared record is what fixes it,
  don't tell me" — the demo that carries the product's headline claim.
- **Observed (reproduced before touching anything):** the D1 reproduction holds
  exactly as written. `POST /compare/demo {"target":100,"turns":100,"source":"deterministic"}`
  → HTTP 200 in 15.1 ms with `goodFinalState.task.completed === false`,
  `current: 99`. Directly at the unit boundary,
  `extractNumber(numberToWords(100))` → `1`, while 1, 21 and 99 all round-trip
  correctly.
- **Root cause:** `src/core/numberWords.ts:extractNumber` returned on the FIRST
  number-word it met. "One hundred" is two tokens, so it returned `1` and never
  read `hundred`. `hundred` is a multiplier over the phrase to its left, so the
  phrase has to be consumed before a value is returned. The reducer asked for
  100, heard 1, classified the utterance as needing a `correction`, and the room
  stalled one short forever. Two sibling implementations of the same parse —
  `src/live/steering.ts:parseLeadingNumberPhrase` and
  `convex/shared.ts:parseLeadingNumberPhrase` — already did this correctly;
  core's was the odd one out, which is why the bug was invisible to the live
  steering tests.
- **Why the suite never caught it:** every existing test counts to 6 or fewer,
  so nothing ever spoke the word "hundred". `comparisonMvp.test.ts` already
  asserted `goodFinalState.task.completed === true` — at `target: 6`.
- **Fixed:** `src/core/numberWords.ts` — the token scan now calls a
  `parseNumberPhrase(tokens, start)` helper that consumes a whole phrase
  (`one hundred` → 100, `one hundred and one` → 101), leaving every other
  behaviour intact (`a hundred` → 100, `ninety nine` → 99, `seven eight` → 7,
  not 15). One guard in the shared function: `extractNumber` is reached by
  `speechActClassifier` → `roomReducer`, which serves BOTH the `/demo`
  comparison and every live room, so no caller was patched individually.
- **Re-proved in the rendered app:** `promotion/evidence/iteration-1/01-demo-100of100.png`
  — `/demo` at defaults (N 100, TURNS 100, SOURCE Sim, 1280×800) reaches
  **SHARED-ROOM PROGRESS 100/100 ● complete**, right pane `roomState.task`
  `current: 100, completed: true`, left pane still `believesCurrent: 1 STUCK`.
  `promotion/evidence/iteration-1/count-to-100.json` holds all 100 timed
  progress samples (100/100 first observed at 124.8 s, ×2 runs),
  `consoleErrors: []`, `failedRequests: []`.
  **Producer (committed, re-runnable from a fresh clone):**
  `scripts/prove-count-to-100.mjs`; it exits non-zero unless the rendered
  progress reaches 100. Header documents the four commands. Playwright is
  installed `--no-save` exactly as `scripts/record-readme-hero.mjs` already
  documents, so `package.json` gains no dependency.
- **Regression check:** `tests/countToOneHundred.test.ts` (3 tests) — a 1..100
  speak/hear round-trip, the hundreds-phrase cases with the unchanged cases
  beside them, and the comparison demo run at the shipped default `target: 100`.
  **Confirmed failing on the pre-fix tree**: with `src/core/numberWords.ts`
  stashed, `vitest run tests/countToOneHundred.test.ts` → **3 failed (3)**,
  including `expected 99 to be 100`. Restored, all 3 pass.
- **Tests:** `npm test` → **7 files, 35 tests passed**, exit 0 (was 6/32).
  `npm run doctor` (`tsc --noEmit` ×2) → exit 0. `npm run build` → exit 0,
  `dist/` 384.08 kB js.
- **Server:** rebuilt and restarted on `PORT=4307` before capture, so the
  evidence is about the tree that now exists.
- **Conditions newly PASS:** **12** (an improvement was verified in the rendered
  app rather than inferred from code — this iteration is the first that has
  anything to verify). Condition 1 moves FAIL → UNVERIFIED, not PASS: J1's
  blocker is gone and J1 now has both halves of evidence, but J2–J5 rest on
  Wave-1 output whose driver scripts were never committed, so the condition as a
  whole is not fully evidenced. Condition 2 stays FAIL — D2 (Invite clipped at
  390px) is still open.
- **Not done, on purpose:** D2, D3 and D4 were left open. One defect per
  iteration; D4 in particular (the 125 s walkthrough pacing) is now measured
  again here — 124.8 s to reach 100 — but changing pacing is a separate change.
