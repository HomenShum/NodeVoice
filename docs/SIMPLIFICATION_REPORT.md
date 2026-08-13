# Simplification report — Wave 3 (codebase reduction)

Measured on Windows 11, Node 22, from a fresh `git clone --depth 20` of commit
`cff4e4d`. Every row names the command that produced it. Re-run any of them; if
a number here disagrees with your terminal, your terminal is right.

The target was **concepts removed**, not lines: dependencies, duplicate
implementations, public exports, and files a reader has to open. Line count is
reported because it is cheap to check, not because it was the goal.

## Before / after

| Measure | Before | After | Change | Evidence command |
|---|---:|---:|---:|---|
| Production files | 53 | 49 | −4 | `find src convex public -type f \( -name '*.ts' -o -name '*.tsx' -o -name '*.css' -o -name '*.html' -o -name '*.js' \) -not -path '*_generated*' \| wc -l` |
| Production source lines | 14,385 | 10,878 | −3,507 (−24%) | same `find` piped to `-exec cat {} + \| wc -l` |
| Direct dependencies | 17 | 6 | −11 (−65%) | `node -e "console.log(Object.keys(require('./package.json').dependencies).length)"` |
| Installed packages | 246 | 104 | −142 (−58%) | `npm ci --no-audit --no-fund` (prints "added N packages") |
| Unused files | 9 | 0 | −9 | `npx knip` |
| Unused exports | 22 values + 24 types | 2 values + 4 types | −40 | `npx knip` |
| Duplicate blocks | 46 clones | 22 clones | −24 | `npx jscpd src convex --ignore "**/_generated/**"` |
| Duplicate percentage | 6.81% (TypeScript 9.76%) | 2.06% (TypeScript 2.94%) | −4.75pp | `npx jscpd src convex --ignore "**/_generated/**"` |
| Circular dependencies | 0 (45 modules, 101 deps) | 0 (45 modules, 101 deps) | 0 | `npx dependency-cruiser --no-config --output-type err src convex` |
| Canonical workflow tests | 7 files / 35 tests, exit 0 | 8 files / 38 tests, exit 0 | +1 file / +3 tests | `npm test` |
| Typecheck | 2 projects (server, client) | 3 projects (+ Convex) | +1 project gated | `npm run doctor` |
| Browser workflow passes | rendered 100/100, exit 0 | rendered 100/100 in 131.4 s, exit 0, `consoleErrors: []`, `failedRequests: []` | held | `BASE_URL=http://127.0.0.1:4506 node scripts/prove-count-to-100.mjs` |
| Production bundle size | 384.08 kB js / 79.15 kB css | 384.23 kB js / 78.73 kB css | +0.15 kB js / −0.42 kB css | `npm run build` |
| Additions/deletions | — | 26 files changed, +293 / −5,734 (plus 4 new files) | — | `git diff --shortstat HEAD` |

Evidence for the browser row is committed at
`promotion/evidence/wave-3/01-demo-100of100-after-reduction.png` and
`count-to-100-after-reduction.json`. The server was rebuilt and restarted on
port 4506 before that capture, so the evidence describes the tree that now
exists. The `promotion/evidence/iteration-1/` files were left untouched so the
numbers quoted in `promotion/PROMOTION_LOG.md` stay true.

**The bundle did not shrink, and that is the finding.** Eleven of the seventeen
direct dependencies were never imported by any source file, so they cost install
time and reader attention but were already absent from the shipped JavaScript.
A reader who saw `livekit-client` and `@radix-ui/react-tabs` in `package.json`
would reasonably have believed this app used LiveKit and Radix tabs. It does
not.

## What was deleted

**A whole second user interface — `public/` (6 files, 2,956 lines).**
Before Vite, the browser UI was hand-written vanilla JS ("Room OS" /
"Local Collab MVP") styled by three vendored Astryx stylesheets. The React
client replaced it, but the old one stayed on disk *and stayed reachable*:
`src/server.ts` served `dist/` if it existed and silently fell back to `public/`
if it did not. A new engineer who ran `npm start` before `npm run build` got a
different, older application and no indication of that. `public/` is gone; the
server now serves only `dist/`, prints a one-line note if it is missing, and
answers `{"ok":false,"error":"client_not_built","hint":"run \`npm run build\`"}`
for page requests. *(This is the one place where externally observable behavior
changed. It changed because the old behavior was a trap, and the change is
recorded here rather than hidden.)*

**Eleven unused dependencies.** `@astryxdesign/cli`, `@astryxdesign/core`,
`@astryxdesign/theme-neutral` (only ever referenced from the deleted
`public/astryx/*.css` comments), `@evilmartians/agent-prism-data`,
`@evilmartians/agent-prism-types`, `@livekit/components-react`,
`livekit-client`, `@radix-ui/react-collapsible`, `@radix-ui/react-tabs`,
`react-json-pretty`, `react-resizable-panels`. Each verified with
`grep -rn "<name>" src convex scripts tests` returning zero matches before
removal, then `npm run doctor && npm test && npm run build` after.

**Forty dead exports.** `PIPELINE_CONFIG`, `LIVE_AGENTS`, `LIVE_DEFAULT_GOAL`,
`ollamaJson` and `getModelsByBucket` were deleted outright; `decideVoiceUtterance`,
`getLocalModelById` and `FALLBACK_OPENAI_MODEL` kept their code and lost their
`export` because only their own module calls them; twenty type aliases stopped
being part of the public surface for the same reason. `src/client/live/roomClient.ts`
had been re-exporting eight symbols and twelve types that nothing imported.

**One duplicated HTTP helper.** `ollamaJson` was a near-verbatim copy of
`ollamaChat` with one extra JSON field, and had no callers.

## What custom code was replaced by something that already existed

This is the reuse ladder's rung (b) — *does this repository already contain it?*
— applied four times. Nothing new was invented; existing implementations were
promoted to a single home under `src/core/` and the copies deleted.

| Was written N times | Now written once in | Copies deleted from |
|---|---|---|
| Human-steering + count-command parser (~450 lines) | `src/core/steering.ts` | `convex/shared.ts` |
| Seat ids, seat count, rotation, agent roster (~90 lines each) | `src/core/agents.ts` | `convex/shared.ts`, `src/live/roomServer.ts`, `src/client/live/useRoom.ts` |
| The router model table with its measured latencies and prices | `src/core/routerModels.ts` | `convex/shared.ts`, `src/live/pipeline.ts` |
| The English number lexicon and `numberToWords` | `src/core/numberWords.ts` | `convex/shared.ts`, `src/core/steering.ts` |
| The room's default goal string | `src/core/agents.ts` | `convex/shared.ts`, `src/live/roomServer.ts`, `src/client/live/LiveRoom.tsx` |

**Why this mattered more than the line count.** The repo's own defect ledger
records the cost: the "count to 100" demo could never reach 100 because
`extractNumber` read only the first token of "One hundred". Two sibling copies
of that parse already handled it correctly — the bug was invisible precisely
*because* there were three implementations and the tests exercised the other
two. There is now one.

**Is the shared code actually deployable?** Convex bundles its functions with
esbuild and follows imports outside the `convex/` directory. That was not
assumed — it was measured by running esbuild with Convex's own flags (read out
of `node_modules/convex/dist/cli.bundle.cjs`) against the real entry points:

```
CONVEX BUNDLE OK — outputs: 9
bundled from outside convex/: [ 'src/core/agents.ts', 'src/core/routerModels.ts',
                                'src/core/numberWords.ts', 'src/core/steering.ts' ]
```

`npm run check:convex` (`tsc --noEmit -p convex/tsconfig.json`) was added to
`npm run doctor` at the same time, because the Convex project was previously not
typechecked by any command in `package.json` — so a break in this new
cross-directory import would have gone unnoticed until deploy.

## Tests added before refactoring, not after

- `tests/liveRoomSeats.test.ts` (new, 3 tests) — drives `handleLive` over a real
  socket: a laptop creates a room, two devices join and are seated 1 and 2, the
  roster grows and clamps at 100, an unknown room id returns 404. This existed
  because `src/core/agents.ts` is now imported by three consumers and needed
  proof it is *wired in*, not merely imported. **Mutation-checked**: changing
  `device: index === 1 ? "laptop" : "phone"` to `device: "phone"` makes it fail
  (`expected … to match object { name: 'Ada', device: 'laptop' }`), and it
  passes again when restored.
- `tests/liveSteering.test.ts` — every behavioural assertion was kept verbatim.
  The loop that ran them against two separate copies now runs them once, and a
  new assertion proves the copies are gone by identity
  (`expect(convexSteering.deriveGoalOverrideFromHuman).toBe(coreSteering.deriveGoalOverrideFromHuman)`).
  That is strictly stronger than the parity check it replaces: identical
  function objects cannot drift. No expectation was loosened and no case was
  dropped.

## Findings left unresolved, with the reason

1. **P1 — the two backends give the steering model different instructions.**
   `convex/openai.ts:interpretHumanSteer` offers the model an `add_goal` intent
   ("also do X in parallel"); `src/live/pipeline.ts:interpretHumanSteer` does
   not list `add_goal` among its allowed JSON shapes at all, even though the
   shared `src/core/steering.ts` handles that intent and
   `agentOsGoalKind` classifies it. The agent-turn prompts have drifted too (the
   Node one carries a "Rules of the room" section the Convex one condenses).
   **Left alone deliberately:** unifying prompt text changes what a model says
   on at least one backend, which is behavior work, not structural work, and
   proving which wording is correct needs a live API key. Recorded in
   `docs/codebase/CONCERNS.md` as the first thing to fix next.
2. **~130 duplicated lines between `src/client/live/useRoom.ts` and
   `useConvexRoom.ts`** (9 of the 22 remaining clones). These are two real
   transports — `fetch` + Server-Sent Events against the Node server, versus
   Convex mutations and a WebSocket subscription — that deliberately expose the
   same hook shape. Merging them means introducing an adapter interface with two
   implementations to remove copy-paste that is mostly `useCallback` wrappers.
   That is adding an abstraction to delete duplication, which the gate's own
   rule 5 warns against. Left as is, documented in
   `docs/codebase/ARCHITECTURE.md`.
3. **Six knip findings remain, all in `src/client/components/ui/`** —
   `badgeVariants`, `buttonVariants`, `BadgeProps`, `ButtonProps`, `InputProps`,
   `SelectProps`. These files are shadcn/ui primitives generated by
   `npx shadcn add` (see `components.json`); trimming their export surface makes
   the next `shadcn add` produce a conflicting diff. Left intentionally.
4. **`playwright` is an unlisted dependency** in `scripts/prove-count-to-100.mjs`
   and `scripts/record-readme-hero.mjs`. This is by design — both scripts
   document `npm i --no-save playwright`, so the browser-capture tooling never
   enters `package.json` or CI install time. Declared in `knip.json`
   `ignoreDependencies` so the finding is explained rather than silently
   suppressed.
5. **Two number parsers coexist** in `src/core/`: `extractNumber` (what did the
   speaker just say?) and `parseLeadingNumberPhrase` (parse a count *command*,
   returning where the phrase ended). They now share one lexicon but not one
   implementation, because their contracts differ at the edges — the command
   parser accepts "a hundred", the listener accepts "zero". Merging them would
   change behavior on both paths for a saving of about twenty lines. Documented
   in `docs/codebase/CONCERNS.md`.
6. **The `promotion/` defect ledger's D2, D3 and D4 are still open** — the
   clipped **Invite** button at 390 px, two unlabelled form controls, and the
   125-second walkthrough pacing. Those are product defects owned by the
   PROMOTION loop, not codebase-reduction work, and Wave 3's rule 3 forbids
   mixing them into a structural change.
