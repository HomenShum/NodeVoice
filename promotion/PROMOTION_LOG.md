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
| D9 | Critical | J1 | **A refused request could hold a socket for five minutes — introduced by iteration 2's own fix.** The 20 MB cap stops KEEPING bytes past the cap but answered only on the client's `end` event, and a client that crosses the cap and then stops sending never sends one. Raw socket: `POST /live/rooms`, `content-length: 1073741824`, write 21 MB, then silence → **no response byte and no close for the full 20 000 ms observation window**; the socket clears only on Node's default `server.requestTimeout` (300 s) or when the client gives up. Memory stayed bounded (server RSS 81.1 MB after the probe against 90.1 idle) and `/health` still answered 200, so this is not D5 returning: it is a fast refusal turned into a held socket, which is a denial-of-service shape of its own. `scripts/prove-p0-boundary.ts` → `evidence/p0-boundary/drain-hang-before.json` → `P1d_over_cap_then_silent`. | **CLOSED — iteration 3** |
| D10 | Critical | J1 | **The whole public API exists twice, and only one copy was bounded.** `convex/http.ts` is a second complete implementation of the same routes — `httpRouter` registers `POST /compare/demo`, `POST /nodeagents/run`, `POST /live/rooms` and `pathPrefix POST /live/rooms/` — and every one of them read its body with a bare `req.json()` (10 raw reads in the file at `git HEAD`, measured). So the 20 MB cap and the `turns`/`target` narrowing closed in iterations 2–3 protected the Node servers and **nothing** on the hosted deployment, which is the copy a permanent URL actually serves. It carried its own `clampTarget` (2..300) and `clampTurns` (3..320) — the caps written a second time, the drift waiting to happen. The guard that was supposed to make this impossible could not see it twice over: `tests/p0Boundary.test.ts` walked `src/` only, and its detector matched `.on("data")` / `for await` only, so a web-`Request` read was invisible even inside the tree it did walk (`OLD detector flags pre-fix convex/http.ts: false`, `NEW: true` — `promotion/evidence/p0-boundary/convex-bypass-guard.txt` §4). Found by an adversarial verifier, not by the suite. | **CLOSED — iteration 4, and MEASURED on a live Convex deployment in iteration 5.** The status that stood here for one iteration, "code-level only; no live Convex probe", is gone because the probe now exists: `POST /compare/demo` with a 25 MB body answers **HTTP 413 `body too large`** on the hosted router (it answered **200** and buffered the whole thing on the pre-fix tree, same deployment, measured minutes apart), `{"target":"abc"}` comes back as the **number** 100 with `completed: true`, `{"turns":3000000}` returns **420 steps**, and a body that is not JSON answers **400** where it used to answer 200 having silently read `{}`. `scripts/prove-convex-boundary.mjs` → `evidence/convex-live/convex-boundary-before.json` / `-after.json`. |
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
    — a race, not a flake). **The unbounded form of that drain shipped a
    regression (D9) and iteration 3 replaced it**; two sentences that described
    the twice-the-cap destroy branch were deleted from this bullet rather than
    annotated, because that branch no longer exists and the numbers under it
    described code that is gone.
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

### Iteration 3 — 2026-08-13

- **Journey exercised:** J1 from the hostile side again, but pointed at
  iteration 2's own fix. An independent verifier re-ran every P0 probe, confirmed
  D5–D8 closed, and measured one thing iteration 2 never probed: what happens
  when a client crosses the body cap and then **stops sending**.
- **Observed (reproduced before touching anything):** the verifier's report holds
  exactly as written. Raw socket to `POST /live/rooms`, `content-length:
  1073741824`, write 21 MB, then send nothing: **no response byte and no socket
  close for the full 20 000 ms window**. Not memory — server RSS was 81.1 MB
  after the probe against 90.1 idle, and `/health` answered 200 throughout. A
  socket held until Node's default `server.requestTimeout` (300 s).
- **Root cause, one layer down:** `readBody`'s promise had exactly two exits,
  `end` and `error`, and **both belong to the client**. Past the cap the answer
  is already decided — nothing the client sends next can change it — but the
  reader still waited for the client to say it was finished. A client that
  crosses the cap and goes quiet never emits either event, so the promise never
  settled, the route never returned, and the response was never written. The
  drain's *rationale* was sound (destroying a socket mid-upload resets it before
  the 413 can be read, measured in iteration 2); its *termination condition* was
  the caller's cooperation.
- **Fixed:** `src/live/roomServer.ts` — crossing the cap now starts a
  `DRAIN_GRACE_MS` (2 s) timer that refuses the request whether or not `end` ever
  arrives. Same `Error("body too large")`, so it lands on the 413-and-close path
  `src/server.ts` already owns — no second response path was written, and the
  `end`-arrives-in-time case is byte-for-byte what it was. The twice-the-cap
  `req.destroy()` branch was **deleted**: with the drain bounded in time it only
  converted a clean 413 into an `ECONNRESET`, and one rule for one policy beats
  two.

  | Probe (both trees, port 4802, Node v22.22.2) | Before | After |
  |---|---|---|
  | raw socket, 1 GB declared, 21 MB written, then silent — time to first response byte | **none in 20 000 ms** | **2 039 ms** |
  | …time to socket close | **none in 20 000 ms** (still open) | **2 040 ms** |
  | …status line | none | `HTTP/1.1 413 Payload Too Large` |
  | …server RSS after / `/health` after | 81.1 MB / 200 | 87.8 MB / 200 |
  | `POST /compare/demo`, 45 MB body (over twice the cap) | `transport_error` — `TypeError: fetch failed` | HTTP **413** `body too large` |
  | …server peak RSS | 132.9 MB | 105.3 MB |
  | `POST /compare/demo`, 25 MB body | HTTP 413, peak 116.5 MB | HTTP 413, peak 92.2 MB |
  | `POST /compare/demo {"turns":3000000}` | 200, 332 steps, peak 81.4 MB | 200, 332 steps, peak 86.7 MB |

  The memory bound iteration 2 won is intact: every peak above sits within
  ~16 MB of the 90 MB idle baseline, against 2 869.7 MB at the original D5
  measurement.
- **Deleted rather than annotated:** iteration 2's bullet claimed "a caller still
  sending at twice the cap gets the socket destroyed" and quoted a 45 MB →
  `ECONNRESET` measurement for it. That branch no longer exists, so both
  sentences are gone from that bullet. `ARCHITECTURE.md` invariant 4 no longer
  describes the cap as a size limit alone; it names the time bound too.
- **Re-proved:** `evidence/p0-boundary/drain-hang-after.json` →
  `P1d_over_cap_then_silent`, `P1b2_body_cap_45mb`. The shipped path is
  unchanged where it should be: `POST /compare/demo {"target":100,"turns":100}`
  → 200 in 51 ms, `{"target":100,"current":100,"completed":true}`, 100 good and
  100 bad steps, provenance still `deterministic sim — scripted utterances ·
  real reducer & scheduler`; `POST /live/rooms {"goal":"count to 10"}` → 200 with
  a room id, read through the same reader. **D9 is not reachable from the
  browser** — no page can declare a content-length it does not send — so its
  proof is at the socket, which is where the defect is.
- **Producer (committed, re-runnable from a fresh clone):** the same
  `scripts/prove-p0-boundary.ts`, extended with `P1d_over_cap_then_silent` (raw
  socket, because `fetch` cannot declare a content-length it does not intend to
  send, nor go silent mid-body) and `P1b2_body_cap_45mb`. Both files below came
  from that one script, `before` with `git stash push -- src` applied so only the
  source differs:

      npx tsx scripts/prove-p0-boundary.ts --label=drain-hang-before --port=4802 --out=promotion/evidence/p0-boundary/drain-hang-before.json
      npx tsx scripts/prove-p0-boundary.ts --label=drain-hang-after  --port=4802 --out=promotion/evidence/p0-boundary/drain-hang-after.json

- **Regression check:** two more tests in `tests/p0Boundary.test.ts` (13 now,
  was 11).
  - *"answers a client that crosses the cap and then stops sending"* — a
    `PassThrough` that writes 21 MB and never ends, asserting the reject arrives
    under 5 s. **Confirmed failing on the pre-fix tree**: with `git stash push --
    src/live/roomServer.ts`, `vitest run --root . tests/p0Boundary.test.ts` →
    **1 failed | 12 passed**, `Error: Test timed out in 5000ms` on exactly that
    test. `git stash pop`, all 13 pass.
  - *"finds no second request-body reader that could carry a different cap"* —
    **discovered, not listed**: it walks `src/` with `readdirSync(recursive)` and
    fails if any file other than `roomServer.ts` reads a request body. A guard
    that consults a list of known callers cannot see the caller nobody
    remembered, which is precisely how `src/server.ts` kept an uncapped reader
    through D5. **Confirmed failing on the tree that had one**: restoring
    `b0bf497^:src/server.ts` makes it fail naming `src/server.ts`, with no list
    anywhere in the test.
- **Tests:** `npm test` → **9 files, 51 tests passed**, exit 0 (was 9/49).
  `npm run doctor` → exit 0; 4 tour/doc citations broken by the line shift in
  `roomServer.ts` were re-pointed, `50 citations checked, 0 broken`.
  `npm run build` → exit 0, `dist/assets/index-*.js` 384.23 kB.
- **Conditions newly PASS:** **none.** D9 was a regression inside work already
  counted, so closing it restores a claim rather than adding one.
- **Not done, on purpose:** D2, D3, D4 remain open. `DRAIN_GRACE_MS` is a fixed
  2 s, not a setting — no measurement asks for a second value, and a knob with
  one caller is a knob nobody tunes. Its ceiling is stated where it lives: a
  client still uploading when the grace expires can see a reset instead of the
  413, which is the same race the drain avoids for everyone who finishes inside
  it.
  A client that stays **under** the cap and then goes silent is a different
  case and is untouched here: it has violated nothing, so the body reader has
  no answer to give, and it sits until Node's own `server.requestTimeout`.
  That is stock Node behaviour for every request this server serves, it is not
  something the cap introduced, and — stated plainly because it is the one
  sentence in this entry with no measurement under it — no probe here exercises
  it.

### Iteration 4 — 2026-08-13

- **Journey exercised:** J1 from the hostile side a third time, pointed at
  iterations 2 and 3's own fixes. An adversarial verifier returned **REFUTED**
  with `seam_actually_closed: false` for exactly one reason, and it was right.
- **Observed (D10, reproduced before touching anything):** the public API exists
  **twice**. `convex/http.ts` registers the same four POST routes the Node
  servers serve — `/compare/demo`, `/nodeagents/run`, `/live/rooms`, and
  `pathPrefix /live/rooms/` — and every one read its body with a bare
  `req.json()`: **10 raw uncapped reads in that file at `git HEAD`**, measured
  by regex over `git show HEAD:convex/http.ts`. The 20 MB cap and the
  `turns`/`target` narrowing therefore protected `src/` and nothing on the
  hosted deployment, which is the copy a permanent URL actually serves.
  `convex/http.ts` also carried its own `clampTarget` (2..300) and `clampTurns`
  (3..320) — the same caps, written down a second time.
- **Root cause, one layer down — and it is the guard, not the router.**
  Iteration 2 replaced a list of known callers with a walk of the tree,
  precisely so the caller nobody remembered would be found. The walk then became
  a list of its own: `readdirSync("../src/")`. `convex/` was never in it, so the
  guard's green tick meant "no second reader **in `src/`**" while
  `ARCHITECTURE.md` invariant 4 read it as "one reader with one cap in both
  servers". The detector had a second, independent hole: it matched
  `.on("data")` and `for await … of req` — the two `node:http` stream shapes —
  so a web `Request` read was invisible to it even inside `src/`. Both had to be
  wrong at once for this to survive, and both were. Measured:
  `OLD detector flags the pre-fix convex/http.ts: false` / `NEW: true`
  (`promotion/evidence/p0-boundary/convex-bypass-guard.txt` §4).
- **Fixed** (at the seam every route routes through, not per route):
  - `src/core/requestBody.ts` — **new**, and the only new file. Holds
    `MAX_BODY_BYTES` (20 MB) plus `readBoundedBody` / `readJsonRequest` for a
    web-standard `Request`. `src/live/roomServer.ts` now **imports** the cap
    instead of declaring it, so there is ONE cap and it cannot drift. There are
    two READERS, because there are two stream types and they refuse
    differently: a socket must be drained for a bounded grace or the client sees
    a reset instead of the 413 (measured in iteration 3), while a web stream is
    cancelled. Invariant 5 already said what two runtimes must agree on lives in
    `src/core/`; the cap now does.
  - `convex/http.ts` — all four registrations read their body through one
    `body<T>(req)` helper (plus `binaryBody(req)` for the single audio route
    that takes bytes, which was an uncapped `req.arrayBuffer()`). Over the cap
    it answers **413**; unparseable JSON now answers **400** instead of being
    silently rounded to `{}` and carrying on. `clampTarget` / `clampTurns` are
    **deleted** in favour of the shared `validCountTarget` / `validTurns`,
    imported through `convex/shared.ts`, the seam this repo already uses for
    everything two runtimes must agree on. Only the hosted demo's DEFAULTS
    (100 / the target) stayed local — a default is not a cap.
  - `tests/p0Boundary.test.ts` — the walk now covers `src/` **and** `convex/`
    (minus `_generated`), and the detector knows the web shapes:
    `req.json|text|arrayBuffer|formData|blob|bytes`. Two files are legal, one
    per stream type, and both take the cap from `src/core/requestBody.ts`.
- **Re-proved — and this is where the honesty line falls.**
  - **Measured, executable, in this pass:**
    - The guard fails on a bypass, twice, proved by adding one and watching it
      name the file: a new `convex/bypassProbe.ts` reading `req.json()`, and the
      shape that actually shipped — `req.json()` put back inside
      `convex/http.ts`. Both failing runs, and the clean run after removing
      them, are captured verbatim in
      `promotion/evidence/p0-boundary/convex-bypass-guard.txt`.
    - The web reader itself, against real `Request` objects: a 21 MB body
      arriving as a `ReadableStream` **with no content-length** is refused
      (`body too large`); exactly `MAX_BODY_BYTES` is accepted; a declared
      oversize `content-length` is refused before the body is read; an ordinary
      body parses and an absent body reads as `{}`, matching the Node reader.
    - Identity, not paraphrase: `convex/shared.ts` re-exports the **same
      function objects** (`validTurns`, `validCountTarget`, `readJsonRequest`,
      `readBoundedBody`) and the same constants, asserted with `toBe`, plus a
      source assertion that `convex/http.ts` does not restate `1024 * 1024`,
      `320` or `300`.
  - **Code-level only, NOT measured — stated plainly because this pass creates
    no accounts, keys or deployments** (this bullet is left standing because it
    was true of iteration 4; **iteration 5 issued the requests and the answer is
    below**): no request was ever issued to a running
    Convex deployment. The claim "the hosted `/compare/demo` now answers 413 to
    a 25 MB body" is **not** proved here the way its Node twin was in iteration
    2 (`before`/`after` against a live server). What is proved is that every
    Convex route reads through the bounded reader, and that the bounded reader
    refuses. The residual assumption is that Convex's `httpAction` `Request`
    exposes `.body` as a `ReadableStream` per the Fetch standard — its type is
    the standard `Request`
    (`node_modules/convex/dist/cjs-types/server/registration.d.ts:890`
    `HttpActionBuilder`). If a runtime handed us a null `.body` for a request
    that declared bytes, `readBoundedBody` **throws** rather than returning
    `{}`, so that assumption failing is loud, not silent.
- **Tests:** `npm test` → **9 files, 55 tests passed**, exit 0 (was 9/51).
  `npm run doctor` → exit 0, `56 citations checked, 0 broken`; five tour/doc
  citations broken by the two-line shift in `roomServer.ts` were re-pointed.
  `npm run build` → exit 0, `dist/assets/index-DVfdxqPP.js` 384.23 kB.
- **Prose corrected:** `docs/codebase/ARCHITECTURE.md` invariant 4 claimed one
  reader with one cap "used by every POST route in both servers". That sentence
  was false for as long as `convex/http.ts` existed. It now says one cap and two
  readers, names both, names the Convex helper every route goes through, and
  records how the guard missed it.
- **Conditions newly PASS:** **none.** D10 is a hole in work already counted —
  closing it restores the claim iterations 2–3 were credited for rather than
  adding a new one. The scorecard should not move on a fix whose headline
  behaviour was never observed running.
- **Not done, on purpose:** D2, D3, D4 remain open. No Convex deployment was
  created to probe the hosted routes live — that needs an account and a
  deployment, so it is left as the one open verification on D10 rather than
  faked. `POST /nodeagents/run` on Convex reads no body at all (it answers 501
  immediately); it is left that way, since not reading a body is a stronger
  bound than reading one carefully.

### Iteration 5 — 2026-08-13

Two things happened here and they are separate: the one open verification from
iteration 4 was closed by measurement, and the two audit conditions that had
never been run were run. The second produced a **worse** scorecard, which is the
correct outcome — UNVERIFIED was never a pass, and measuring a thing for the
first time is allowed to find it broken.

#### 1. D10's open verification — the hosted routes, probed live

- **Journey exercised:** J1 from the hostile side, on the copy a permanent URL
  actually serves. Iteration 4 bounded `convex/http.ts` and said so plainly: *"no
  request was ever issued to a running Convex deployment"*. That sentence is now
  answered rather than repeated.
- **How:** an **isolated Convex DEV deployment** created for this probe
  (`npx convex dev --once --configure new --project nodevoice-live`), never
  production, never `convex deploy --prod`. `.env.local` holds the deployment
  name and URLs and is gitignored (`.gitignore:33`, `.env*.local`); it was not
  committed. No API keys were set on the deployment — none of these routes need
  one, which is the whole reason they are worth probing.
- **Both trees, same deployment, twenty-six seconds apart.** The `before` capture
  is the pre-fix router restored into the working tree
  (`git show 30253b4^:convex/http.ts > convex/http.ts`) and pushed to the same
  deployment; the `after` capture is `git diff --quiet convex/http.ts` clean
  against HEAD. Both files therefore record the same `commit` — only the
  deployed source differs, exactly as iteration 2's `git stash push -- src` pair
  did.

  | Probe (hosted `httpAction`, x3 where the refusal has two shapes) | Before | After |
  |---|---|---|
  | `POST /compare/demo`, 25 MB body | **3/3 accepted, HTTP 200**, 2251/2301/2252 ms | **0/3 accepted, 3/3 `413 body too large`**, 514/761/629 ms |
  | `POST /live/rooms`, 25 MB body | **3/3 accepted, HTTP 200 — and a room was WRITTEN** (`roomId: jn792g1m…`) | **0/3 accepted, 3/3 `413 body too large`** |
  | `POST /compare/demo`, body that is not JSON | **HTTP 200** — silently read as `{}` and ran the default 100-count | **HTTP 400** with the parse error |
  | `POST /compare/demo {"target":"abc"}` → `task.target` | `100` (**number**), `completed: true` | `100` (**number**), `completed: true` |
  | `{"target":1e9,"turns":5}` → `task.target` | `300` | `300` |
  | `{"turns":3000000}` → steps returned | `420` (320 bad + 100 good), 230 832 B | `420`, 230 832 B |
  | `{"target":100,"turns":100}` → the shipped default | 200, 100 good / 100 bad, `completed: true` | unchanged |

- **What that table says that a summary would hide.** Two of the three things
  this probe was asked to check were **already bounded on Convex before the
  fix** — `{"target":"abc"}` came back as a number and `{"turns":3000000}` was
  clamped to 320 — because `convex/http.ts` carried its **own** `clampTarget`
  (2..300) and `clampTurns` (3..320). That is D10's actual shape: not "the
  hosted copy was unbounded", but "the hosted copy was bounded by a second
  written-down copy of the numbers, which is the drift waiting to happen". What
  was genuinely open on the hosted router, and is now closed, is the **body
  cap** (a 25 MB upload was buffered whole, and on `/live/rooms` it also wrote a
  row) and the **silent `{}` parse**. Saying "the flood is now bounded" would be
  true and misleading; it was bounded before, by the copy iteration 4 deleted.
- **Producer (committed, re-runnable from a fresh clone):**
  `scripts/prove-convex-boundary.mjs`. It exits non-zero on any failed
  expectation — the `before` run exits 1 naming three, the `after` run exits 0.
  It reads its base URL from the runner's own gitignored `.env.local`, so a
  verifier probes **their** deployment, not one named here:

      npx convex dev --once --configure new --project nodevoice-live --team <team>
      node scripts/prove-convex-boundary.mjs --label=convex-live-after --out=promotion/evidence/convex-live/convex-boundary-after.json

- **The deployment host is redacted in both artifacts, on purpose and stated
  here so it is not mistaken for something hidden.** These routes are public and
  take no key, so a live dev URL committed to a public repo is a write endpoint
  anyone can drive; and the gate's re-runnability comes from the producer, which
  gives the verifier their own deployment. Everything measured — statuses,
  bodies, returned values, timings — is in the files.
- **Two defects found in the measuring instruments themselves, both fixed
  before any number here was quoted:**
  - The streaming step counter double-counted. It carried 8 characters between
    chunks while the needle `"turn":` is 7, so a needle landing entirely inside
    the carry was counted in its own chunk and again in the next — **421 steps
    reported where 420 were returned**, and which number you got depended on
    where the network split the response. The carry must be `needle - 1`. Fixed
    in the new script and in the same line of `scripts/prove-p0-boundary.ts`,
    which had it first. No committed number in iterations 2–3 depended on it
    being exact, but a producer that answers differently on re-run is a producer
    nobody can check.
  - The refusal has two shapes. Cancelling a web request stream can reset the
    connection before the client reads the response — the same race iteration 2
    measured on the Node reader and answered there with a bounded drain, which a
    web stream has no equivalent of. One `after` run therefore saw
    `TypeError: fetch failed` on `/live/rooms` where the next saw `413`. Rather
    than retry until it looked clean, the probe now issues each over-cap upload
    **three times** and asserts what is both stable and the thing that matters:
    **no attempt is accepted.** That is a sharper claim, not a weaker one — the
    pre-fix tree fails it 3/3, and the accompanying `read413` / `connectionReset`
    counts are recorded so the split is visible rather than averaged away.
- **Conditions newly PASS:** **none.** Same reasoning iteration 4 gave: D10 was a
  hole in work already counted. What changed is that the claim is now a
  measurement instead of a reading.

#### 2. Conditions 7 and 8 — the two audits that had never been run

Both had stood UNVERIFIED since baseline for the honest reason that no audit
existed. Both are now run, with committed output and a committed producer, and
**both are FAIL.**

- **Condition 8 — web-quality audit.** `scripts/run-web-audit.sh` runs the two
  pinned tools the gate names against the built client on port 4901:

      npm run build && PORT=4901 npx tsx src/server.ts &
      bash scripts/run-web-audit.sh    # promotion/evidence/web-audit/

  | Surface | Lighthouse 13.4.1 perf / a11y / best-practices / SEO | LCP | CLS | TBT | axe 4.13.0 |
  |---|---|---|---|---|---|
  | `/` lobby | **73** / 98 / 100 / 82 | **4.4 s** | 0 | 20 ms | 2 rules, 14 nodes, **0 serious** |
  | `/demo` | **70** / 98 / 100 / 82 | **4.8 s** | 0 | 40 ms | 3 rules, 13 nodes, **2 serious** |

  Two majors, and they are different in kind. **(a)** axe raises
  `label-title-only` (**serious**) twice on `/demo`: two `<select>` controls are
  named only by their `title` attribute, with no visible label. **(b)** Largest
  Contentful Paint is 4.4 s and 4.8 s under Lighthouse's default mobile
  emulation, which is the "poor" band; the render-blocking and
  network-dependency-tree insights fail with it. CLS is 0 and TBT is 20–40 ms —
  the page does not *jank*, it arrives late, which is why condition 10 (measured
  against interaction, not against first paint) is unaffected. The remaining axe
  findings are `landmark-one-main` and `region` (both **moderate**, 24 nodes
  across the two pages): no `<main>`, so no page content sits in a landmark.
- **Condition 7 — Web Interface Guidelines review.** A review, not a tool, and
  deliberately not a Lighthouse score wearing a different label: the two measure
  different things, and condition 7 is about interface *behaviour*. The Vercel
  Web Interface Guidelines were fetched from https://vercel.com/design/guidelines
  on 2026-08-13 and the rendered app was driven against them at 1280×800 and
  390×844 on both `/` and `/demo` — `scripts/review-web-interface-guidelines.mjs`
  → `evidence/wig-review/wig-findings.json` plus four screenshots. **33 findings:
  12 major, 21 minor**, each carrying the DOM measurement that produced it. The
  major ones reduce to four distinct guidelines:

  | Guideline | Measurement |
  |---|---|
  | Forms — *"Labels everywhere"* | 2 controls on `/` reach the accessibility tree with **no name at all** (the Shared-goal `<textarea>` and the join-code `<input>` — this is open defect **D3**, found independently); 3 controls on `/demo` are named **only by `title`**, which axe flags separately as serious |
  | Interactions — *"Match visual & hit targets ≥24px"* | the N and TURNS number inputs on `/demo` are **40×16 px**; the only link from the lobby to the demo is **198×16 px** |
  | Animations — *"Honor `prefers-reduced-motion`"* | **0** occurrences of `prefers-reduced-motion` in the whole built stylesheet, against 6 rules that animate and 5 `@keyframes` blocks. A user who has asked their OS to stop motion still gets all of it |
  | Content — *"Accurate page titles"* | `/` and `/demo` report the **same** `<title>`, so a tab, a bookmark and the Back menu cannot tell them apart |

  Minor findings, kept because they are cheap and real: no `<main>` landmark and
  no skip link on either page; 9 lobby buttons and 4 demo buttons leave
  `touch-action: auto`; 3 controls render below 16 px so iOS Safari zooms on
  focus; the two agent-count steppers are icon-only and named only by `title`;
  one button ships disabled before the user has typed anything.
- **What the review did NOT find, measured rather than assumed.** *"Clear focus —
  every focusable element shows a visible focus ring"* **passes**: all 12 lobby
  tab stops and all 10 demo tab stops change pixels when focused. That answer
  cost two rewrites and is the reason this section exists at all —
  - a first pass read `outline` and `box-shadow` from the computed style and
    reported **5 of 10 demo stops with no ring**. That was wrong. Tailwind leaves
    a fully transparent ring placeholder (`rgba(0,0,0,0) 0px 0px 0px 0px`) on
    every button, which reads as "has a shadow" and paints nothing, and
    `outline: auto` reads as present on controls where nothing is drawn. The
    check now **photographs the control's box focused, blurs it, photographs the
    same box, and compares the bytes** — a ring that changes no pixel is not a
    ring. The caret, CSS animation and transition are suppressed first, each
    because it made the diff lie once, and a region that does not photograph
    identically twice while nothing is focused is recorded **UNMEASURED**, not
    passed.
  - the same pass walked the page with `blur()` between stops, which leaves the
    sequential-navigation starting point where it was; the walk re-visited the
    same four controls instead of advancing. Returning focus to `document.body`
    fixed it, and the lobby then yielded **12** stops — the same 12 the Wave-1
    `a11y.tabOrder` measurement found by a different method.
  - two other detectors were also wrong and were corrected before anything was
    quoted: the two agent-count steppers were reported as **unnamed** icon-only
    buttons when they carry `title` attributes that do reach the accessibility
    tree (which is why axe's `button-name` rule passes on them) — downgraded to
    a minor "named only by title"; and the animated-rule count read the
    `transition:` shorthand only, reporting **1** animated rule in a stylesheet
    that has 6, because Tailwind emits longhands.
- **Conditions moved:** **7 UNVERIFIED → FAIL**, **8 UNVERIFIED → FAIL**. Nothing
  moved to PASS. The scorecard goes from 6 PASS / 3 FAIL / 3 UNVERIFIED to
  **6 PASS / 5 FAIL / 1 UNVERIFIED**, and it is a more honest board than the one
  before it.
- **Tests:** `npm test` → **9 files, 55 tests passed**, exit 0 (unchanged —
  nothing in `src/` or `convex/` was edited). `npm run doctor` → exit 0,
  `56 citations checked, 0 broken`. `npm run build` → exit 0.
- **Not done, on purpose:** none of the 12 major WIG findings or the 2 serious
  axe violations were fixed. This pass was asked to *run* the audits that had
  never been run, and fixing 14 findings in the same pass that first measured
  them would leave nobody able to tell which number belonged to which tree. D2,
  D3 and D4 remain open; D3 is now confirmed twice over by two independent
  instruments. Condition 1 still needs one committed driver for J2–J5, which
  none of this touched.
