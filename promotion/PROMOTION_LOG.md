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
| D5 | Critical | J1 | **A public route with `access-control-allow-origin: *` will allocate as much memory as it is asked to.** `POST /compare/demo {"turns":3000000}` → the bad-side loop builds one `ComparisonStep` (with three private-state snapshots) per requested turn. Measured on a freshly started server: idle RSS **89.8 MB → peak 2869.7 MB in 12.0 s**, then HTTP 500 because the reply could not even be stringified. Nothing in the request needs a key. `POST /voice/demo` is the same hole with one extra step: its loop also stops when the task completes, so it needs D6 to stay open — `{"target":"abc","turns":20000}` never completes and returned **4 975 601 bytes** of transcript at peak **176 MB** in 3.3 s (`applyUtterance` copies the utterance array every turn, so the cost is quadratic). Reproduction and every number: `scripts/prove-p0-boundary.ts`, `evidence/p0-boundary/before.json` → `P1_turns_flood`, `P1c_voice_demo_sibling`. | **CLOSED — iteration 2** |
| D6 | Critical | J1 | **A string crossed the boundary into a field typed `number`, and the room could then never complete.** `POST /compare/demo {"target":"abc"}` → HTTP 200 with `goodFinalState.task.target === "abc"` (a *string*, straight back out of the API). The reducer finishes a count with `current >= target`, and `1 >= "abc"` is never true, so the shared room counts forever: with `turns: 20` it reached `current: 20` against target `"abc"` and `completed: false`. `{"target":1e9}` was accepted verbatim too. `evidence/p0-boundary/before.json` → `P2_target_string`, `P2b_target_huge`, `P2c_completes_after_narrowing`. | **CLOSED — iteration 2** |
| D7 | Major | J1 | **Provenance claimed a model wrote text the model did not write.** `runSideBySideComparison({source:"openai"})` computed provenance *before* the run, so when the provider failed after the left-hand side finished, the result still read `mode: "openai"`, `modelId: "gpt-5.4-mini"`, and `good: "openai · gpt-5.4-mini · live · real reducer & scheduler"` — while all three right-hand turns were the deterministic fallback. The authors' own comment two lines above says provenance must reflect what generated the text; the Ollama case was handled, the mid-run OpenAI failure was not. `evidence/p0-boundary/before.json` → `P3_provenance_after_midrun_failure`. | **CLOSED — iteration 2** |
| D8 | Major | J1 | **Every provider error was swallowed silently and the fallback was committed as a model turn.** `runVoiceStep({source:"openai"})` with `OPENAI_API_KEY` unset (so `openaiChat` throws before any network call) did **not** throw: it returned normally, committed the utterance "One" as a real `speechAct: "task_action"`, advanced `task.current` to 1, and logged nothing — `warningsLogged: 0`, nothing reported to the caller. `evidence/p0-boundary/before.json` → `P4_silent_provider_swallow`. | **CLOSED — iteration 2** |

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

### Iteration 2 — 2026-08-13

- **Journey exercised:** J1, from the other side — not "does the demo finish"
  but "what does the demo do when the request is hostile or the provider is
  down". Four defects (D5–D8), all measured against a running server before
  anything was edited.
- **Observed (reproduced before touching anything):** every number below is from
  `promotion/evidence/p0-boundary/before.json`, produced by
  `scripts/prove-p0-boundary.ts` on commit `9dd0300`, Node v22.22.2, against a
  server the script started itself on port 4701.

  | Probe | Before | After |
  |---|---|---|
  | `POST /compare/demo {"turns":3000000}` — server peak RSS | **2869.7 MB** (idle 89.8) | **92.3 MB** (idle 89.7) |
  | …steps returned / status / elapsed | 0 / HTTP 500 / 12 024 ms | 332 / HTTP 200 / 1 285 ms |
  | `POST /voice/demo {"target":"abc","turns":20000}` — the sibling route | 200, **4 975 601 B** of transcript, peak **176 MB**, 3 282 ms | 200, **5 669 B**, peak 116 MB, 1 270 ms |
  | `POST /compare/demo` with a 25 MB body | HTTP **200**, buffered whole | HTTP **413** `body too large` |
  | `POST /compare/demo {"target":"abc"}` → `task.target` | `"abc"` (**string**) | `12` (**number**) |
  | `{"target":1e9}` → `task.target` | `1000000000` | `300` (`MAX_COUNT_TARGET`) |
  | `{"target":"abc","turns":20}` → `task.completed` | **false** (can never complete) | **true** |
  | openai run, provider fails mid-run → `provenance.mode` | `"openai"` | `"deterministic"` |
  | …`modelId` / `fallbackTurns` / `good` label | `"gpt-5.4-mini"` / absent / `"…live · real reducer & scheduler"` | `null` / `3` / `"deterministic fallback — gpt-5.4-mini produced no turn (3/3 failed) · real reducer & scheduler"` |
  | `runVoiceStep({source:"openai"})`, no key → fallback recorded | **0** reports, **0** warnings | **1** report, **1** warning |

- **Root cause, one layer down from each symptom:**
  - D5/D6: the route narrowed `source` and `model` and then passed `target` and
    `turns` through untouched. `ARCHITECTURE.md` invariant 4 lists the
    narrowers, and the two fields NOT on that list are exactly the two that
    reached the reducer.
  - D5 also: `src/server.ts` carried its **own** `readJson` with no size cap,
    while `src/live/roomServer.ts` had capped at 20 MB all along. Two readers,
    one cap.
  - D7: provenance was a prediction, written from the *requested* source before
    either loop ran. Only the Ollama case could be checked up front
    (reachability), so only the Ollama case was honest.
  - D8: `catch { return deterministic; }` had no channel to tell anyone it had
    fired, so no caller *could* be honest about it. D7 is D8's consequence.
- **Fixed** (at the seam, not at the named path — every caller was grepped
  first):
  - `src/core/agents.ts` — `MAX_RUN_TURNS` moved here from `roomServer.ts` (the
    live room's existing per-run cap, now the one cap both servers import) plus
    `validTurns`, in the shape `validAgentCount` already had.
  - `src/core/steering.ts` — `MAX_COUNT_TARGET` exported (already the repo's
    count cap, used by the steering parser) plus `validCountTarget`.
  - `src/core/roomReducer.ts` — `createVoiceRoom` narrows `target`. Every caller
    that builds a counting room routes through it: both HTTP routes, both CLIs,
    the compare loops.
  - `src/compare/badGoodDemo.ts` — narrows `target`/`turns` once at the top of
    `runSideBySideComparison`, the seam the route, the CLI and the tests all
    share; provenance moved *below* the runs and is computed by
    `describeProvenance` from `fallbackTurns`.
  - `src/server.ts` — deleted its uncapped `readJson` and imports the live
    path's; `/voice/demo` narrows its own `target`/`turns`; an over-sized body
    answers **413** with `connection: close`.
  - `src/live/roomServer.ts` — `readJson` exported; past the cap the reader
    stops *keeping* bytes but keeps draining, because destroying the socket
    while the client is still uploading resets the connection before it can read
    the 413 (measured: the probe got `transport_error` and a hand-run got `413`
    — a race, not a flake). A caller still sending at twice the cap gets the
    socket destroyed; measured rather than assumed, because a defensive branch
    nothing has ever executed is not a defence: a 45 MB body on port 4704 →
    `ECONNRESET`, server peak RSS **92.0 MB** against 89.5 idle, and `/health`
    still 200 afterwards.
  - `src/voice/voiceAgent.ts` — the bare `catch` now logs and calls
    `onProviderError`; the fallback text itself is unchanged.
- **Preserved on purpose:** the deterministic and all-model provenance strings
  are byte-identical to before (`tests/comparisonMvp.test.ts` and
  `tests/openaiCompare.test.ts` still assert them, untouched), and the shipped
  default run is unchanged: `POST /compare/demo {"target":100,"turns":100}` →
  `{"target":100,"current":100,"completed":true}`, 100 good steps, 100 bad
  steps.
- **Re-proved in the rendered app:**
  `evidence/p0-boundary/01-demo-100of100-after-p0-fixes.png` — `/demo` at
  shipped defaults still reaches **SHARED-ROOM PROGRESS 100/100 ● complete**,
  `roomState.task.completed: true`, footer still reads `text source:
  deterministic sim — scripted utterances · real reducer & scheduler`. Produced
  by the committed `scripts/prove-count-to-100.mjs`
  (`BASE_URL=http://127.0.0.1:4701`), samples in
  `count-to-100-after-p0-fixes.json` (100/100 at 125.9 s). Iteration 1's copies
  of those two files were restored with `git checkout` rather than overwritten.
  **None of D5–D8 is reachable from the browser** — the `/demo` inputs are
  number fields capped at 100 and never send a string — so their proof is at the
  API, which is where the defects are.
- **Producer (committed, re-runnable from a fresh clone):**
  `scripts/prove-p0-boundary.ts`. It starts its own server, samples that
  process's working set while each request is in flight, drains the flood
  response without holding it in memory, and writes one JSON file. Both files
  here were produced by the same script minutes apart — the `before` run with
  `git stash push -- src` applied, so only the source differs between them.
  `after.json` was re-captured on the fix commit, which is why its `commit`
  field names it rather than the pre-fix parent. The peak-RSS figures in the
  `after` column include whatever the probes before them left on the heap (the
  server is never re-started mid-file); the point is the order of magnitude,
  89.7 MB idle → 2869.7 MB before, → ~116 MB after:

      npx tsx scripts/prove-p0-boundary.ts --label=before --out=promotion/evidence/p0-boundary/before.json
      npx tsx scripts/prove-p0-boundary.ts --label=after  --out=promotion/evidence/p0-boundary/after.json

- **Regression check:** `tests/p0Boundary.test.ts` — 11 tests, one describe per
  defect plus a "nothing changed for an honest run" guard.
  **Confirmed failing on the pre-fix tree**, twice over: with `git stash push --
  src` (tests and scripts kept), `vitest run tests/p0Boundary.test.ts` → **10
  failed, 1 passed** (the passing one is the no-regression guard, which is
  correct). Because 5 of those failures were "not a function" on the new
  exports, the same five claims were also run as a temporary file importing
  nothing new, so they fail on *values*: `expected 3000000 to be 320`,
  `expected 'string' to be 'number'`, `expected false to be true`,
  `expected 'openai' to be 'deterministic'`, `expected [] to have a length of
  1`. `git stash pop`, all 11 pass. The temporary file was deleted, not
  committed.
- **Tests:** `npm test` → **9 files, 49 tests passed**, exit 0 (was 8/38 — the
  11 new tests are the D5–D8 regression check). `npm run doctor` (`tsc --noEmit`
  ×3 + citations) → exit 0; 19 tour/doc citations broken by my line shifts were
  re-pointed, `50 citations checked, 0 broken`. `npm run build` → exit 0,
  `dist/assets/index-*.js` 384.23 kB.
- **Docs:** `docs/START_HERE.md` Step 4 showed a return containing
  `badFinalState`, an identifier that exists nowhere in `src/`, `tests/`,
  `convex/` or `scripts/`; corrected to the real shape, with the reason there is
  no such thing (the left-hand room has no shared state to end in).
  `ARCHITECTURE.md` invariant 4 now names `validCountTarget`, `validTurns` and
  the single capped body reader.
- **Conditions newly PASS:** **none.** Condition 11 was re-measured and stays
  PASS on fresh numbers. Condition 2 stays FAIL: D2 (Invite clipped at 390 px)
  is untouched, and an iteration cannot close a condition it did not work on.
  Condition 12 stays PASS on iteration 1's evidence plus this iteration's
  rendered re-proof.
- **Not done, on purpose:** D2, D3, D4 remain open. `convex/rooms.ts` keeps its
  own `MAX_AUTO_RUN_TURNS = 320` — a pre-existing duplicate of the same number;
  collapsing it means touching the Convex runtime, which no probe here
  exercises.
