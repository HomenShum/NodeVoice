# Product goal — NodeVoice

## Who opens this, and what they are trying to finish

Three friends are walking down a street, each holding a phone with its own
talking assistant, and one of them says "count to 100 together." The assistants
do not count. They congratulate each other. "Yeah, exactly." "Sounds good, go
ahead." Nobody ever says "seven," because each assistant only hears the others
*talk* — none of them can see a single shared piece of paper that says which
number the group has already reached. The person who opens NodeVoice is usually
the one who just watched that happen and is now trying to decide whether it is a
model problem or a plumbing problem, because they are about to build something
that depends on the answer. They arrive with one question: *if I put several
voice assistants in one conversation, what actually has to exist for them to
finish a task together?* They walk away holding two things they can point at.
First, a side-by-side run they started themselves, where the left-hand room —
assistants that only hear each other's speech — is visibly stuck, and the
right-hand room, which writes to one shared record every device reads and
updates (the **room state**), visibly advances. Second, a room they created on
their laptop that a second device joined by scanning a code, so the two devices
are demonstrably in the *same* room rather than merely in the same building.
The one sentence the product exists to make concrete: being physically in the
same room is not the same as being computationally in the same room.

## The gate

This repo is judged by the twelve-condition PROMOTION gate, which lives in one
place and is not restated here:

**https://github.com/HomenShum/NodeKit/blob/main/templates/promotion/GATE.md**

Gate variant: `full`

Scoring vocabulary is PASS / FAIL / **UNVERIFIED**, and UNVERIFIED is never PASS.

## Canonical journeys

The work queue lives in [PRODUCT_JOURNEYS.md](PRODUCT_JOURNEYS.md). A journey
without browser evidence is unfinished, however green the tests are.

## Loop state

Every iteration is recorded in [PROMOTION_LOG.md](PROMOTION_LOG.md) — journey
exercised, defect fixed, evidence path, conditions newly passing. Loop state
lives in git, never in an agent's memory, so any agent can resume the loop cold.

## Current scorecard

Baseline measured 2026-08-13 against commit `06b4198`, driving the built client
(`npm run build` → `dist/`) served by `src/server.ts` on port 8791, in headless
Chromium via Playwright. Evidence paths below are relative to `promotion/`.

| # | Condition | Status | Evidence / reason |
|---|-----------|--------|-------------------|
| 1 | Journeys succeed end-to-end in a real browser | FAIL | J2, J3, J4, J5 each reached their done-when in the browser (`evidence/baseline/08`, `17`, `18`, `13`, `15`). J1 does not: `/demo` → **Run the comparison** stalls at `99/100` and never reaches the promised 100 — polled every 2s for 322s, first hit 99/100 at 125s and stayed. See defect D1. |
| 2 | No critical or major usability defect open | FAIL | D1 (the "count to 100" demo can never reach 100 — the product's headline claim) and D2 (the **Invite** control is clipped past the viewport at 390px) are both open. Ledger in [PROMOTION_LOG.md](PROMOTION_LOG.md). |
| 3 | Mobile and desktop both intentional | FAIL | Mobile is *mostly* deliberate: the join flow has a purpose-built 390px consent screen (`evidence/baseline/17-phone-joined-390.png`) and the room reflows to a single column (`10-room-mobile-390.png`). But the room header's action group ends at x=399 in a 390px viewport, clipping **Invite** — measured, not eyeballed (`findings-pass2.json` → `mobileClip`). A primary action falling off the edge is accidental, not intentional. |
| 4 | No horizontal overflow at supported widths | PASS | `document.scrollWidth === clientWidth` at 390 / 768 / 1280 on the lobby, at 390 on `/demo`, and at 390 in a live room — 5 measurements, 0 overflowing. `evidence/baseline/findings.json` → `overflow[]`. (D2 clips inside a non-scrolling container, so it is scored under condition 3, not here.) |
| 5 | Loading/empty/success/error/agent-running designed | PASS | All five observed and captured: loading = "Creating…" spinner and "Simulating room…" (`06-demo-running.png`); empty = a room before any utterance shows the QR-invite panel instead of a blank transcript (`08-room-created.png`); success = "Room created. Ada joined on this device." (`08`); error = "turn failed: Error: OPENAI_API_KEY is not configured on the server" plus a trace row "Auto-run halted on error" (`13-room-start-nokey.png`, `15-room-state-drawer.png`); agent-running = live progress bar, "Speaking" badge and a Running button (`07-demo-result.png`). |
| 6 | Keyboard and basic accessibility pass | FAIL | Keyboard half passes: 12 Tab stops reach every lobby control and each one shows a focus indicator (outline `auto/3px` or a focus ring box-shadow) — `findings.json` → `a11y.tabOrder`, `03-lobby-keyboard-focus.png`. Accessibility half fails: 2 controls have no programmatic label — the "Shared goal" textarea (its `<label>` is a sibling with no `for`/`id`) and the join-code input (`placeholder="e.g. x7k2mp"` only). 0 unlabelled buttons, 0 images missing `alt`, `lang="en"` present. |
| 7 | Web Interface Guidelines: no major unresolved | UNVERIFIED | The Vercel Web Interface Guidelines review was not run in this wave. No finding list exists, so there is nothing to call resolved or unresolved. |
| 8 | Web-quality audit: no major unresolved | UNVERIFIED | No Lighthouse / Core Web Vitals / axe run was performed. The hand-rolled DOM checks under condition 6 are not a substitute for the audit this condition names. |
| 9 | No unexplained console errors or failed requests | PASS | Console (error + warning + pageerror) and network (`requestfailed` + any status ≥ 400) listeners were attached across three driver passes covering every journey — lobby, `/demo` run to 99/100, room create, Start without a key, steering, State drawer, and a two-context join. Result: `console: []`, `failedRequests: []` in both `findings.json` and `findings-pass2.json`, and `ERRORS: []` on the join pass. The missing-key failure surfaces as a designed in-app message, not a failed request. |
| 10 | Performance does not obstruct interaction | PASS | `POST /compare/demo` (target 100, turns 100) returns in **13.8 ms** (`curl -w time_total`). Lobby first load 993 ms; room creation round-trip 3575 ms. The UI stays interactive *during* the walkthrough: switching to the NodeAgent tab mid-run settled in ~121 ms (821 ms measured minus a 700 ms scripted wait). `findings.json`/`findings-pass2.json` → `timings`. The 125 s walkthrough is deliberate pacing of an already-computed result, not blocked interaction — recorded here so the number is auditable rather than hidden. |
| 11 | Tests and build green | PASS | `npm test` → 6 files, 32 tests passed, exit 0. `npm run build` → vite 8.1.3, 1936 modules, `dist/` written, exit 0. `npm run doctor` (`tsc --noEmit` ×2) → exit 0. All three run from a clean `npm install` (246 packages, exit 0) on commit `06b4198`. |
| 12 | Verified in the rendered app, not inferred from code | UNVERIFIED | Wave 1 is a baseline: no improvement was made, so this condition has nothing to verify. It cannot be PASS on a vacuous truth. |

**Status: NOT PROMOTED** — 5/12 PASS.
