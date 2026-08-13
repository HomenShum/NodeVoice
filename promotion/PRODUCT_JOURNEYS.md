# Canonical journeys — NodeVoice

Three to five real workflows. Not feature tours: a journey is one person, one
goal, and the artifact they hold when it worked. These are the promotion loop's
work queue, exercised in order of importance.

**A journey with no browser evidence is unfinished**, regardless of test status.

All evidence below was captured on 2026-08-13 against commit `06b4198`, driving
the built client served by `src/server.ts` (port 8791) in headless Chromium.
Paths are relative to `promotion/`.

## Journey shape

Each journey states, in this order:

- **Persona and situation** — who arrived, and why today.
- **Goal** — what they want to be true when they leave.
- **Steps** — what they actually do, in the UI, in order.
- **Done when** — the observable artifact or state that proves completion.
- **Evidence** — path to the capture that shows it working. Empty until proven.

---

## J1 — "Show me that the shared record is what fixes it, don't tell me"

- **Persona and situation:** A developer who has just watched two assistants
  politely agree with each other instead of doing the task. They will not accept
  a diagram; they want to start the failure themselves and watch the fixed
  version run beside it.
- **Goal:** Watch one room fail and the other finish the *same* task, with the
  shared record visible while it happens.
- **Steps:**
  1. Open `http://localhost:8787/` (the lobby, `src/client/live/LiveRoom.tsx`).
  2. Click **or watch the bad-vs-good demo →**, which routes to `/demo`
     (`src/client/main.tsx` path routing → `src/client/App.tsx`).
  3. Leave the defaults (N 100, TURNS 100, SOURCE Sim) and click
     **Run the comparison** — this POSTs `/compare/demo`
     (`src/server.ts` → `src/compare/badGoodDemo.ts`).
  4. Watch the two panes and the `roomState` JSON on the right.
- **Done when:** SHARED-ROOM PROGRESS reads **100/100**, the right pane's
  `roomState.task.completed` is `true`, and the left pane's three private states
  are still `believesCurrent: 1 STUCK`.
- **Evidence:** `evidence/baseline/07-demo-result.png` (28/100, both panes live),
  `evidence/baseline/11-demo-stalled-99of100.png` (99/100 — the run's real end state).
  **The done-when is NOT met: progress stalls at 99/100.** See defect D1.
  Left pane stuck-at-1 and the live JSON are proven; completion is not.

## J2 — "Start a room on my laptop and get a second device into it"

- **Persona and situation:** The same developer, now testing the claim that this
  is a *shared* room rather than two independent chat windows. They have a laptop
  and a phone and no API keys configured.
- **Goal:** One room that exists on the server, with an invite they can act on.
- **Steps:**
  1. Open `http://localhost:8787/` — the lobby.
  2. Optionally edit **Shared goal**, pick a version card (V0–V3), set the
     starting roster, choose Public/Private.
  3. Click **Create room** → POST `/live/rooms` (`src/live/roomServer.ts`).
- **Done when:** The header shows `room <code>`, a QR and a six-character join
  code are on screen with a copyable invite URL, and the toasts read
  "Room created…" and "Ada joined on this device."
- **Evidence:** `evidence/baseline/08-room-created.png` (room 066607, QR, code,
  `http://localhost:8791/?room=066607`, both toasts). **PASSES.**

## J3 — "Join from the phone and confirm we are in the same room"

- **Persona and situation:** The second device — a phone at 390px — held by a
  friend standing next to the host. This is the journey that separates
  "physically in the same room" from "computationally in the same room."
- **Goal:** Be a second agent inside the host's room, visible to the host.
- **Steps:**
  1. Open the site on the phone, type the host's code into **Join a room**
     (`placeholder="e.g. x7k2mp"`) and press **Join** → resolves via
     `GET /live/rooms`, then POST `/live/rooms/:id/join`.
  2. On the purpose-built mobile consent screen choose **My agent** and tap
     **Join & enable sound**.
- **Done when:** The phone is assigned its own agent identity and *both* devices
  show the same room code with the same device count.
- **Evidence:** `evidence/baseline/17-phone-joined-390.png` and
  `18-host-after-join.png`. Driven as two independent browser contexts (1280 and
  390): phone identity `Ben`; both headers read
  `room 10e27b · 2/2 agent devices connected`; `ERRORS: []`. **PASSES.**

## J4 — Steering and receipt: "I changed my mind mid-run — prove the room heard me"

- **Persona and situation:** The host, partway through, decides the plan is
  wrong. In an agent product this is the moment trust is won or lost: a
  correction that vanishes into a transcript is indistinguishable from a
  correction that was ignored.
- **Goal:** Type a correction, then see, in the room's own record, that it
  arrived and what the room did with it.
- **Steps:**
  1. In a live room, type into **Message or steer the agents** and press Enter →
     POST `/live/rooms/:id/human` (`src/live/steering.ts`).
  2. Click **State** in the header to open the Internal State + Trace Inspector
     drawer.
- **Done when:** The steer appears verbatim in the room, and the Trace Inspector
  shows a timestamped row for it plus a row saying how the room interpreted it.
- **Evidence:** `evidence/baseline/14-room-steer.png` and
  `15-room-state-drawer.png`. Trace rows captured: `UTTERANCE RECEIVED — you
  steered: Actually, skip the museum — make it a coffee stop.`,
  `INTENT INTERPRETED — Human steer interpreted as none.`, `GUARDRAIL EVALUATED
  — LLM intent interpreter failed; used deterministic fallback.`, alongside the
  full reducer JSON. **Receipt PASSES.** The steer's *effect on the task* is
  unproven: with no `OPENAI_API_KEY` the intent interpreter falls back and
  resolves the steer to `none`. Re-run with a key to close this.

## J5 — Recovery: "I have no API key — does it lie to me?"

- **Persona and situation:** A stranger who cloned the repo, skipped the `.env`
  section, and pressed the big orange button. The failure mode that matters here
  is not the outage; it is an agent product reporting success it did not achieve.
- **Goal:** Find out truthfully that the run cannot proceed, and still have a
  usable room.
- **Steps:**
  1. Create a room with no `.env.local` present (server reports
     `live: { openai: false, elevenlabs: false }` on `/health`).
  2. Click **Start** → the turn pipeline calls `keyOrThrow("OPENAI_API_KEY")`
     (`src/live/pipeline.ts`).
- **Done when:** The UI states the specific missing configuration, says the run
  halted, and the room remains navigable without a reload.
- **Evidence:** `evidence/baseline/13-room-start-nokey.png` — toast reads
  `turn failed: Error: OPENAI_API_KEY is not configured on the server`, and the
  Trace Inspector row reads `GUARDRAIL EVALUATED — Auto-run halted on error.`
  The room, QR, invite and steer input all stay usable; no page error, no failed
  request. **PASSES** — the honest-failure path is the one that works best here.

---

## Journeys every agent surface owes

- **Recovery** — covered by **J5**. Observed: named cause, explicit halt, room
  survives.
- **Steering** — covered by **J4**, partially. The correction is received and
  receipted; whether it *retargets the task* needs a key and is unproven.
- **Receipt** — covered by **J4**. The State drawer is this product's strongest
  surface: version-specific reducer JSON beside a timestamped, per-row-expandable
  trace of every state change.
