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
Chromium via Playwright. Rows 1, 2, 11 and 12 were re-measured in **iteration 1**
(2026-08-13, port 4307, same method) after the D1 fix; rows 2 and 11 again in
**iteration 2** (2026-08-13, port 4701) after the D5–D8 fixes; every other row
still carries its baseline measurement and is labelled as such. Evidence paths
below are relative to `promotion/`.

Rows **7 and 8** carry **iteration 5** measurements (2026-08-13, port 4901,
Lighthouse 13.4.1 + axe-core 4.13.0 + a Playwright guidelines review): the first
time either audit has been run on this repo. Iteration 5 also closed the one
verification iteration 4 left open — the hosted Convex routes, probed on a live
deployment — which moves no row, because D10 was a hole in work already counted.

Iteration 2 changed **no** status. It closed four defects that are invisible from
the browser — they live at the HTTP boundary, and the `/demo` controls cannot
express them — so its proof is API-level (`evidence/p0-boundary/before.json` vs
`after.json`, producer `scripts/prove-p0-boundary.ts`) plus a rendered
re-proof that the headline journey still reaches 100/100
(`evidence/p0-boundary/01-demo-100of100-after-p0-fixes.png`).

| # | Condition | Status | Evidence / reason |
|---|-----------|--------|-------------------|
| 1 | Journeys succeed end-to-end in a real browser | UNVERIFIED | **J1 now reaches its done-when** and is the only journey with both halves of evidence: output `evidence/iteration-1/01-demo-100of100.png` + `count-to-100.json` (`100/100 ● complete`, `roomState.task.completed: true`), producer `scripts/prove-count-to-100.mjs`, committed and re-runnable. J2–J5 were observed reaching their done-when in Wave 1 (`evidence/baseline/08`, `17`, `18`, `13`, `15`) but their Playwright drivers lived in a session scratchpad and were never committed, so those four are ephemeral measurements under the gate's evidence rule. Not FAIL — nothing here is observed broken; not PASS — four fifths of it cannot be re-run. Closing this needs one committed driver for J2–J5. |
| 2 | No critical or major usability defect open | FAIL | D1 (the "count to 100" demo could never reach 100 — the product's headline claim) is **CLOSED** in iteration 1: root cause `src/core/numberWords.ts:extractNumber` read only the first token of "One hundred", fixed at the shared function, re-proved in the rendered app. D5–D8 (unbounded `turns` → 2859 MB RSS; a string `target` reaching the reducer so the room could never complete; provenance claiming a model wrote deterministic text; every provider error swallowed) are **CLOSED** in iteration 2, each with a before/after measurement in `evidence/p0-boundary/`. D2 (the **Invite** control is clipped past the viewport at 390px) is still open, and it is Major, so this condition stays FAIL. Ledger in [PROMOTION_LOG.md](PROMOTION_LOG.md). |
| 3 | Mobile and desktop both intentional | FAIL | Mobile is *mostly* deliberate: the join flow has a purpose-built 390px consent screen (`evidence/baseline/17-phone-joined-390.png`) and the room reflows to a single column (`10-room-mobile-390.png`). But the room header's action group ends at x=399 in a 390px viewport, clipping **Invite** — measured, not eyeballed (`findings-pass2.json` → `mobileClip`). A primary action falling off the edge is accidental, not intentional. |
| 4 | No horizontal overflow at supported widths | PASS | `document.scrollWidth === clientWidth` at 390 / 768 / 1280 on the lobby, at 390 on `/demo`, and at 390 in a live room — 5 measurements, 0 overflowing. `evidence/baseline/findings.json` → `overflow[]`. (D2 clips inside a non-scrolling container, so it is scored under condition 3, not here.) |
| 5 | Loading/empty/success/error/agent-running designed | PASS | All five observed and captured: loading = "Creating…" spinner and "Simulating room…" (`06-demo-running.png`); empty = a room before any utterance shows the QR-invite panel instead of a blank transcript (`08-room-created.png`); success = "Room created. Ada joined on this device." (`08`); error = "turn failed: Error: OPENAI_API_KEY is not configured on the server" plus a trace row "Auto-run halted on error" (`13-room-start-nokey.png`, `15-room-state-drawer.png`); agent-running = live progress bar, "Speaking" badge and a Running button (`07-demo-result.png`). |
| 6 | Keyboard and basic accessibility pass | FAIL | Keyboard half passes: 12 Tab stops reach every lobby control and each one shows a focus indicator (outline `auto/3px` or a focus ring box-shadow) — `findings.json` → `a11y.tabOrder`, `03-lobby-keyboard-focus.png`. Accessibility half fails: 2 controls have no programmatic label — the "Shared goal" textarea (its `<label>` is a sibling with no `for`/`id`) and the join-code input (`placeholder="e.g. x7k2mp"` only). 0 unlabelled buttons, 0 images missing `alt`, `lang="en"` present. |
| 7 | Web Interface Guidelines: no major unresolved | FAIL | Review performed in **iteration 5** against the Vercel Web Interface Guidelines (fetched 2026-08-13 from https://vercel.com/design/guidelines), driving the rendered app at 1280×800 and 390×844 on `/` and `/demo`. **33 findings: 12 major, 21 minor**, each with the DOM measurement that produced it. Four distinct major guidelines: *Labels everywhere* (2 controls on `/` with no accessible name — defect D3; 3 on `/demo` named only by `title`), *Match visual & hit targets ≥24px* (the N/TURNS inputs are 40×16 px; the lobby's only link to the demo is 198×16 px), *Honor `prefers-reduced-motion`* (0 such rules in the built stylesheet against 6 animated rules and 5 `@keyframes`), *Accurate page titles* (`/` and `/demo` share one `<title>`). Output `evidence/wig-review/wig-findings.json` + 4 screenshots; producer `scripts/review-web-interface-guidelines.mjs`, committed, exits non-zero while a major is open. This is a review, **not** a Lighthouse score relabelled — condition 8 holds those, and they measure different things. *Clear focus* was measured and **passes**: 12/12 lobby and 10/10 demo tab stops change pixels when focused, decided by photographing each control focused vs blurred rather than by reading `box-shadow`, which had reported 5 false failures. |
| 8 | Web-quality audit: no major unresolved | FAIL | Run in **iteration 5** with the two pinned tools, against the built client on port 4901; producer `scripts/run-web-audit.sh`, output in `evidence/web-audit/`. **Lighthouse 13.4.1** — `/`: performance **73**, accessibility 98, best-practices 100, SEO 82, **LCP 4.4 s**, CLS 0, TBT 20 ms. `/demo`: performance **70**, accessibility 98, best-practices 100, SEO 82, **LCP 4.8 s**, CLS 0, TBT 40 ms. **axe-core 4.13.0** — `/`: 2 rules / 14 nodes, 0 serious. `/demo`: 3 rules / 13 nodes, **2 serious** (`label-title-only`: two `<select>` controls named only by `title`). Two majors stand: the serious axe violations, and an LCP in the "poor" band on both surfaces under default mobile emulation. CLS 0 and TBT 20–40 ms say the page does not jank — it arrives late — which is why condition 10, measured against interaction rather than first paint, is unaffected. Moderate and unfixed: `landmark-one-main` + `region` (no `<main>`, 24 nodes across the two pages). |
| 9 | No unexplained console errors or failed requests | PASS | Console (error + warning + pageerror) and network (`requestfailed` + any status ≥ 400) listeners were attached across three driver passes covering every journey — lobby, `/demo` run to 99/100, room create, Start without a key, steering, State drawer, and a two-context join. Result: `console: []`, `failedRequests: []` in both `findings.json` and `findings-pass2.json`, and `ERRORS: []` on the join pass. The missing-key failure surfaces as a designed in-app message, not a failed request. |
| 10 | Performance does not obstruct interaction | PASS | `POST /compare/demo` (target 100, turns 100) returns in **13.8 ms** (`curl -w time_total`). Lobby first load 993 ms; room creation round-trip 3575 ms. The UI stays interactive *during* the walkthrough: switching to the NodeAgent tab mid-run settled in ~121 ms (821 ms measured minus a 700 ms scripted wait). `findings.json`/`findings-pass2.json` → `timings`. The 125 s walkthrough is deliberate pacing of an already-computed result, not blocked interaction — recorded here so the number is auditable rather than hidden. |
| 11 | Tests and build green | PASS | Re-measured in iteration 2: `npm test` → **9 files, 49 tests passed**, exit 0 (iteration 1 was 7/35; the 11 new tests are the D5–D8 regression check in `tests/p0Boundary.test.ts`). `npm run build` → exit 0, `dist/assets/index-*.js` 384.23 kB. `npm run doctor` (`tsc --noEmit` ×3 + `check-citations`) → exit 0, `50 citations checked, 0 broken` — the 19 tour/doc citations that iteration 2's line shifts broke were re-pointed, not silenced. |
| 12 | Verified in the rendered app, not inferred from code | PASS | Iteration 1's D1 fix was re-proved by driving the built client in headless Chromium, not by reading the diff: `/demo` at shipped defaults reaches SHARED-ROOM PROGRESS `100/100 ● complete` with `roomState.task.completed: true` on screen (`evidence/iteration-1/01-demo-100of100.png`), 100 timed progress samples in `evidence/iteration-1/count-to-100.json`. The server was rebuilt and restarted on port 4307 before capture. Producer `scripts/prove-count-to-100.mjs` is committed and exits non-zero if the rendered progress is not 100, so the claim is re-runnable rather than remembered. |

**Status: NOT PROMOTED** — 6/12 PASS, 5 FAIL, 1 UNVERIFIED. Iteration 5 ran the
two audits that had never been run and both came back FAIL, so the board is two
rows worse and one row less ignorant than it was: rows 7 and 8 moved UNVERIFIED →
FAIL, and nothing moved to PASS. (Iterations 2–4 were 6/12 PASS, 3 FAIL,
3 UNVERIFIED; iteration 1 the same 6/12; baseline 5/12 PASS, 4 FAIL,
3 UNVERIFIED.) A condition measured for the first time is allowed to fail —
UNVERIFIED was never a pass, and the only way this number gets worse is by
looking.
