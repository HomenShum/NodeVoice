# Steering-layer adversarial review — 2026-07-05

Scope: goal-retarget + count-task layer shipped in 6ee8654. **22 confirmed / 0 refuted** (3 lenses × verify agents).

Status: REVIEW ONLY — nothing fixed yet. Triage before fixing.

## [1] HIGH · convex/shared.ts:157 · intent_parsing

**Defect:** parseNumberPhrase returns the first DIGIT anywhere in the captured tail, beating a word-number that immediately follows 'count to', so trailing digits hijack the target. Identical bug in src/live/steering.ts:99.

**Evidence:** extractCountTarget's capture group ([\w\s-]+) greedily grabs everything to end of message (punctuation is stripped to spaces first), and parseNumberPhrase checks /\b(\d{1,3})\b/ before parsing word numbers. Verified: "count to five, then take 2 minutes to reflect" => "Count from 1 to 2 ..." (agents count 1,2 and stop); "count to ten, we have 30 seconds" => "Count from 1 to 30 ..." (target 30 instead of 10).

**Suggested fix:** Parse the number phrase positionally from the START of the captured group: tokenize and accept only a contiguous number phrase (digits or words) beginning at token 0, stopping at the first non-number token — instead of a digit-anywhere regex over the whole tail. Alternatively make the capture lazy up to the first number phrase. Apply to both convex/shared.ts and src/live/steering.ts.

## [2] HIGH · convex/rooms.ts:253 · intent_parsing

**Defect:** Any mid-count human utterance that merely MENTIONS 'count(ing) to N' — encouragement or a question — is treated as a goal override and unconditionally resets countNext to 1, wiping counting progress even when the derived goal is byte-identical to the current goal.

**Evidence:** Verified: with room goal "Count from 1 to 20 out loud..." at countNext=15, human says "keep counting to twenty" => deriveGoalOverrideFromHuman returns the exact same goal string, but submitHuman's `if (goalOverride)` branch applies countPatchForGoal(goalOverride) which is deriveCountTask(goal) with default next=1 — count restarts at 1. Question form also fires: "are we counting to twenty or thirty?" => "Count from 1 to 20 ..." (reset to 1, and the 'or thirty' alternative is silently dropped). Same in src/live/roomServer.ts:625-628 via applyGoal(), which always sets countNext = task.next = 1.

**Suggested fix:** In submitHuman (convex/rooms.ts) and the /human route (src/live/roomServer.ts), no-op the override when goalOverride === room.goal (preserve countNext/done handling deliberately). Additionally, in deriveGoalOverrideFromHuman, don't retarget on interrogatives — bail when the trimmed text ends with '?' or starts with are/is/what/why/how/do/did (the raw text still reaches the agents as pendingHuman, so nothing is lost).

## [3] HIGH · src/live/roomServer.ts:325 · reducer_state

**Defect:** runOneTurn commits with no floor/token revalidation, so a stop→start on /run while a turn is in flight produces two concurrent runOneTurn calls for the same slot that BOTH commit: duplicate utterance (same count number spoken twice), turn counter double-incremented, floor flipped twice.

**Evidence:** runOneTurn's reducer (lines 325-334: `room.state.turn += 1; ... room.state.floorOwner = slot === "a" ? "b" : "a"`) runs unconditionally after the multi-second `await generateAgentTurn(...)`. The /run route (line 571: `if (running && !room.state.running) { ... void runLoop(room); }`) checks only `room.state.running`, not `room.busy`, and loopToken is checked only at the TOP of runLoop's while (line 369) — never at commit time. Scenario: room counting to 10, next=5; loop A is awaiting the LLM (busy=true). User taps Stop (`running=false; loopToken++`) then Start (`running=true; runLoop B starts with a fresh token`). B calls runOneTurn for floorOwner "a" while A's runOneTurn is still in flight for the same slot with the same captured countTask{next:5}. A's LLM returns and commits (turn+1, floor→b, countNext→6, pushes "Five"); then B's returns and also commits (turn+1 again, coerceCountTurn forces its text to "Five" again, floor set to "b" again). Transcript shows Ada: "Five", Ada: "Five"; room.turn advanced by 2 for one logical count step. The Convex twin explicitly guards against exactly this in commitAgentTurn ("a stale hop ... must never commit"); the node reducer has no equivalent.

**Suggested fix:** Capture the loopToken and floorOwner at runOneTurn entry and re-validate both immediately before the mutation block (discard the turn if `room.loopToken !== capturedToken || room.state.floorOwner !== slot`), and/or make POST /run start refuse while `room.busy` is true (mirror the /step 409). Also pass the token into runOneTurn from runLoop so manual /step and loop turns share one guard.

## [4] HIGH · src/live/roomServer.ts:391 · transport_parity

**Defect:** Node run loop halts auto-run on the raw LLM `done` even when a mid-turn retarget invalidated it; Convex continues running on the new goal.

**Evidence:** runOneTurn returns `{ done: turn.done, text: turn.text }` (line 352) — the raw pre-guard done, not `effectiveDone = goalUnchanged && turn.done` (line 330). runLoop then does `if (outcome.done || !room.state.running) break;` (line 391) and falls through to `room.state.running = false`. Convex path: commitAgentTurn computes `done: room.done || (goalUnchanged && args.done) || countDone` (convex/rooms.ts:361), so after a mid-turn retarget done stays false, and scheduleNext (rooms.ts:408) sees running && !done and schedules the next hop — the chain continues. Scenario: agents are finishing a goal (LLM emits done=true, e.g. saying the final count number) while the human steers 'new goal: count to 30' during that turn's LLM/TTS latency. Convex: room keeps auto-running on the new goal. Node: room.state.done correctly stays false but the loop breaks and sets running=false — the room silently stops and the steer is never acted on until the user presses Start again.

**Suggested fix:** In runOneTurn return `done: effectiveDone` (the goal-guarded value) instead of `turn.done`, so runLoop only breaks when the completion applies to the current goal.

## [5] MEDIUM · convex/shared.ts:119 · intent_parsing

**Defect:** The 'actually/instead' correction branch hijacks approvals and negations as new goals: looksLikeTask matches noun/negated uses of plan/count/list/etc., so a spoken agreement replaces the room goal and clears done/recentActs. Identical in src/live/steering.ts:61.

**Evidence:** Verified: "actually that plan sounds great" => goal becomes "that plan sounds great"; "actually, I like the second plan better" => goal "I like the second plan better"; "actually, don't count the museum, it's closed" => goal "don't count the museum, it's closed". In submitHuman/roomServer these overwrite room.goal, reset done=false and recentActs=[], and drop any active count task (countPatchForGoal returns undefined targets), so a mid-count "actually ..." remark kills the count task entirely.

**Suggested fix:** Tighten the correction branch: require an imperative task shape, e.g. the task verb must appear as the leading verb of the captured clause (/^(?:please\s+)?(?:let'?s\s+)?(count|plan|write|...)\b/i) rather than anywhere in it, and reject clauses starting with a negation (don't/do not/never) or containing sentiment-only patterns (sounds good/great/like).

## [6] MEDIUM · convex/shared.ts:149 · intent_parsing

**Defect:** No negation handling plus first-match-wins: a correction of the form "don't count to X, count to Y" locks onto the negated first target X. Identical in src/live/steering.ts:91.

**Evidence:** Verified: "don't count to ten, count to twenty" => "Count from 1 to 10 out loud, ... stopping exactly at 10." The user's actual instruction (20) is discarded because the unanchored regex matches the first 'count to ten' and never sees the second clause. Similarly "please don't count to 100" (a request to STOP) starts a count-to-100 task.

**Suggested fix:** In extractCountTarget, iterate all matches (matchAll) and take the LAST match; skip any match whose preceding ~3 tokens contain don't/do not/never/stop/quit. The plain idioms ("count on you", "don't count on it") are already safe — this is specifically about negated 'count to N' clauses.

## [7] MEDIUM · convex/shared.ts:110 · intent_parsing

**Defect:** Count extraction runs BEFORE the explicit 'new goal:' matcher, so an explicitly-set goal that incidentally mentions counting is hijacked into a count-to-N task. Identical in src/live/steering.ts:52.

**Evidence:** Verified: "new goal: write a song about counting to ten" => "Count from 1 to 10 out loud, one number per agent turn, stopping exactly at 10." — the user's explicitly stated goal (write a song) is replaced by a bare counting task because deriveGoalOverrideFromHuman checks extractCountTarget(text) first (shared.ts:110-111) and only then the explicit goal regex (line 114).

**Suggested fix:** Reorder: match the explicit 'new goal/change goal/set goal/...' regex first and use its captured clause as the goal verbatim (running extractCountTarget only on that captured clause to decide whether it is a pure count task, e.g. clause starts with 'count'). Keep whole-text count extraction as the fallback.

## [8] MEDIUM · convex/shared.ts:128 · intent_parsing

**Defect:** "count from X to Y" silently discards the start value: the regex consumes the 'from X' clause but deriveCountTask always initializes next=1, so the agents count 1..Y instead of X..Y. Identical in src/live/steering.ts:70.

**Evidence:** Verified: "count from 50 to 60" => "Count from 1 to 60 out loud, one number per agent turn, stopping exactly at 60." The user asked for 11 numbers (50-60) and gets 60 turns starting at one. The 'from' clause is explicitly matched by (?:\s+from\s+[\w\s-]+?)? in extractCountTarget (shared.ts:149) and then thrown away; buildCountGoal (line 131) hard-codes 'from 1'.

**Suggested fix:** Capture the 'from' group, parseNumberPhrase it, and thread it through: deriveGoalOverrideFromHuman -> buildCountGoal(start, target) ('Count from X to Y ...'), and deriveCountTask should parse the start back out of the goal to seed next=start (clamped to [1, target]).

## [9] MEDIUM · convex/rooms.ts:361 · reducer_state

**Defect:** The goal guard in commitAgentTurn is not airtight for `done`: it compares goal STRINGS, so a human restarting the same count goal mid-flight (countNext reset to 1) still satisfies goalUnchanged, and the stale terminal turn's args.done marks the room done and halts the run right after the user asked to start over.

**Evidence:** Line 361: `done: room.done || (goalUnchanged && args.done) || countDone`. The count ADVANCE is correctly double-guarded (line 352-353: `countCommitted = goalUnchanged && ... && args.countNext === countTask.next`), but args.done is gated only on `room.goal === args.goal`. Scenario: room at goal buildCountGoal(10), countNext=10; the terminal hop is in flight — coerceCountTurn (shared.ts:135-145) set its done=true because captured next>=target. Human says "count to 10" again; submitHuman derives goalOverride = buildCountGoal(10), a byte-identical string, and patches `done:false, countNext:1` (rooms.ts:247-254). The in-flight commit then sees goalUnchanged=true, countCommitted=false (args.countNext 10 !== current next 1, so the count correctly does NOT advance), but `goalUnchanged && args.done` is true → room.done=true with countNext=1/10. scheduleNext (line 408-412) sees room.done and kills the run. Net effect: the human's restart instantly ends the room as "done" at 1 of 10, and the serializer shows the contradiction (state.done=true, task.completed=false at line 96). Same ABA hole applies to non-count goals retargeted A→B→A within one turn.

**Suggested fix:** When a count task is active on the room, gate the done flag on countCommitted too: `done: room.done || (countTask ? countDone : (goalUnchanged && args.done))`. For the general ABA case, add a monotonically-increasing `goalVersion` bumped by setGoal/submitHuman retargets, pass it through produceTurn to commitAgentTurn, and compare versions instead of strings.

## [10] MEDIUM · src/live/roomServer.ts:332 · reducer_state

**Defect:** Node reducer advances countNext from the STALE pre-LLM countTask with no equality re-check, so a mid-flight retarget to the same count goal (restart) has its countNext=1 reset silently clobbered back to capturedNext+1 — and if the in-flight turn was terminal, the room is also falsely marked done.

**Evidence:** Lines 331-334: `if (goalUnchanged && countTask) { room.state.countNext = Math.min(countTask.next + 1, countTask.target); } if (effectiveDone) room.state.done = true;` — `countTask` was captured at line 289 before the seconds-long `await generateAgentTurn`, and unlike the Convex commit (rooms.ts:353 requires `args.countNext === countTask.next` against CURRENT state) there is no re-check against `room.state.countNext` at commit time. Scenario: counting to 10, next=5, turn in flight (will say "Five"). Human POSTs /human "count to 10" → deriveGoalOverrideFromHuman returns buildCountGoal(10), identical to the current goal string → applyGoal (line 137-150) resets countNext=1, done=false. The in-flight commit then computes goalUnchanged=true (same string) and writes countNext = min(5+1,10) = 6, erasing the restart; the agents continue 6, 7, 8... If instead next was 10 (terminal turn in flight), effectiveDone=true additionally sets done=true and countNext back to 10 — restart fully reverted and room declared complete.

**Suggested fix:** Re-check at commit time that the room's current count state still equals the captured task before advancing: `if (goalUnchanged && countTask && room.state.countNext === countTask.next && room.state.countTarget === countTask.target) { ... }`, and gate `effectiveDone` on the same condition when a count task is active (mirroring the fix to convex/rooms.ts:361).

## [11] MEDIUM · convex/coordinator.ts:105 · reducer_state

**Defect:** stepOnce has no running/busy guard (unlike the node server's /step 409), so a manual step racing an in-flight auto-run hop can steal the floor; the auto hop's commit is rejected with "lost floor" and runTurn returns without scheduling the next hop or clearing state — the room is left stuck with running=true and a dead hop chain.

**Evidence:** stepOnce (lines 100-108) reads the room and calls produceTurn with no check of `room.running` — compare roomServer.ts:587 which rejects step with `if (room.busy || room.state.running) { json(res, 409, ...) }`. Race: auto-run hop for slot "a" is awaiting the LLM; a client calls stepOnce, which reads floorOwner="a" and commits first (floor→b, countNext advanced). The auto hop's commitAgentTurn then hits the floor guard (rooms.ts:315: `if (room.floorOwner !== args.slot) ... return { committed: false, reason: "lost floor" }`), and runTurn line 85 (`if (!out.committed) return;`) exits WITHOUT calling scheduleNext and without touching running/runToken. No future hop exists, runToken is still current, so nothing ever flips running to false: the UI shows a running room that never speaks again until the user manually Stops and Starts. The count does not double-advance (floor + countNext equality guards hold) — the defect is the silently killed chain under a dishonest running=true.

**Suggested fix:** Guard stepOnce: `if (room.running) throw new Error("room is auto-running")` (or return {ok:false}). Additionally, in runTurn, when commit fails with reason "lost floor" on a still-current token, re-schedule via scheduleNext instead of returning, so the chain survives a floor steal instead of dying with running=true.

## [12] MEDIUM · src/live/roomServer.ts:391 · reducer_state

**Defect:** runLoop stops on the RAW LLM done instead of the reducer's effective done, so when a human retargets the goal while a terminal turn is in flight, the reducer correctly refuses done (goal changed) but the loop still breaks and sets running=false — the run silently dies immediately after the retarget it was supposed to follow.

**Evidence:** runOneTurn returns `{ done: turn.done, ... }` (line 352) — the pre-guard value — while the reducer only commits `effectiveDone = goalUnchanged && turn.done` (line 330). runLoop line 391: `if (outcome.done || !room.state.running) break;` then lines 394-397 set `room.state.running = false`. Scenario: counting to 5, next=5, terminal turn in flight (coerceCountTurn sets done=true). Human POSTs "count to 20" → applyGoal sets a new goal string, countTarget=20, countNext=1. The commit correctly skips done and count advance (goalUnchanged=false), but outcome.done=true breaks the loop and running flips to false with no error trace: room sits idle at 1/20, done=false, running=false. The Convex twin gets this right — runTurn ignores turn.done and scheduleNext re-reads room.done from the DB (rooms.ts:408).

**Suggested fix:** Have runOneTurn return the committed effectiveDone (or have runLoop check `room.state.done` instead of `outcome.done`): `if (room.state.done || !room.state.running) break;` so the loop's stop condition matches the reducer's state.

## [13] MEDIUM · convex/rooms.ts:408 · reducer_state

**Defect:** Cumulative-turn budget makes legal count targets unreachable: scheduleNext requires room.turn < 140 but deriveCountTask accepts targets up to 300, and room.turn never resets on retarget — a 'count to 200' run halts silently at turn 140 mid-count, after which every Start press advances exactly one turn.

**Evidence:** rooms.ts:9 `MAX_AUTO_RUN_TURNS = 140` vs shared.ts:75 `MAX_COUNT_TARGET = 300`; a count to N needs N committed agent turns. scheduleNext line 408: `if (room.running && !room.done && room.runToken === args.token && room.turn < MAX_AUTO_RUN_TURNS)` — `room.turn` is lifetime-cumulative (retargets in setGoal/submitHuman never reset it), so any turns burned on a previous goal also count against the new count task. Past the cap the failure mode degrades further: setRunning(true) always schedules one hop (line 279), that hop commits (turn becomes 141), then scheduleNext's second branch (line 410-412) flips running back to false — one number per Start press, with no trace or system utterance explaining why (the halt at line 411 writes nothing to traces). The node twin doesn't share this exact bug because its MAX_RUN_TURNS counter is per-runLoop invocation (roomServer.ts:367-368), so restarting grants a fresh 140.

**Suggested fix:** Either clamp MAX_COUNT_TARGET below the auto-run budget, or make the budget per-run: store `runStartTurn` when setRunning starts and compare `room.turn - runStartTurn < MAX_AUTO_RUN_TURNS`. Also emit a trace/system utterance when scheduleNext halts on the cap so the stop is honest and observable.

## [14] MEDIUM · src/live/roomServer.ts:368 · transport_parity

**Defect:** Turn caps disagree: Convex caps at 140 cumulative room turns forever; Node caps at 140 turns per Start press.

**Evidence:** Node: `while (room.state.running && !room.state.done && count < MAX_RUN_TURNS)` where `count` is a local variable reset to 0 on every runLoop invocation (line 366-368) — each Start grants a fresh 140 turns, unbounded over the room lifetime. Convex: scheduleNext gates on `room.turn < MAX_AUTO_RUN_TURNS` (convex/rooms.ts:408) where `room.turn` is the cumulative counter incremented by every turn including manual stepOnce. Once a Convex room reaches 140 total turns, every subsequent Start executes exactly one turn (setRunning schedules runTurn without the cap check, rooms.ts:279) and then scheduleNext force-stops it — the room permanently degrades. Concrete divergence: run a goal to completion around turn 100, retarget with 'count to 100' and press Start — Node completes the count; Convex stops at 40 numbers in with running flipped off.

**Suggested fix:** Pick one semantic and apply it to both transports — either make Node count against room.state.turn, or make Convex track turns-since-run-start (e.g. store runStartTurn on setRunning and gate on room.turn - runStartTurn < 140).

## [15] MEDIUM · src/live/roomServer.ts:331 · transport_parity

**Defect:** Node's stale-goal guard for count advancement checks only the goal string, so a retarget to the identical count goal (a restart) is silently overwritten by the in-flight turn; Convex preserves the reset.

**Evidence:** Node: `if (goalUnchanged && countTask) { room.state.countNext = Math.min(countTask.next + 1, countTask.target); }` (lines 331-333) where countTask is the snapshot captured at turn start. Convex additionally requires the live count state to still match the snapshot: `countCommitted = goalUnchanged && countTask !== null && args.countTarget === countTask.target && args.countNext === countTask.next` (convex/rooms.ts:352-353). buildCountGoal is deterministic, so a human saying 'count to 10' while the room is already on that goal produces a byte-identical goal string — deriveGoalOverrideFromHuman fires, applyGoal resets countNext to 1, but goalUnchanged stays true. If a turn was in flight (room mid-count at next=7), the Node commit overwrites countNext back to 8, losing the restart; the Convex commit sees args.countNext(7) !== room.countNext(1), skips the advance, and the restart sticks. Same guard gap also lets the stale turn's countDone mark the room done against the freshly reset task on Node.

**Suggested fix:** Mirror the Convex guard in runOneTurn: only advance/complete the count when room.state.countTarget/countNext still equal the countTask captured at turn start, in addition to the goal-string check.

## [16] MEDIUM · convex/coordinator.ts:85 · transport_parity

**Defect:** Convex allows stepOnce while auto-run is active; if the manual step wins the floor race the auto-run chain dies with running=true stuck forever. Node rejects the same request with 409.

**Evidence:** stepOnce (coordinator.ts:100-108) has no running/busy guard — it calls produceTurn unconditionally. If it commits first, the concurrent auto-run hop's commitAgentTurn returns `{ committed: false, reason: "lost floor" }` (convex/rooms.ts:315-323), and runTurn then does `if (!out.committed) return;` (coordinator.ts:85) — the chain stops with no scheduleNext and nothing resets room.running, leaving the room permanently claiming running=true with no scheduled hop (dishonest status until the user manually toggles Stop/Start). Node prevents the whole class: `if (room.busy || room.state.running) { json(res, 409, { ok: false, error: "room is busy" }); }` (roomServer.ts:587-589).

**Suggested fix:** Either reject stepOnce when room.running is true (matching Node's 409), or on a 'lost floor' non-commit have runTurn re-schedule/re-check instead of silently abandoning the chain while running=true.

## [17] MEDIUM · src/live/roomServer.ts:290 · transport_parity

**Defect:** Node consumes the pending human steer before the LLM call, so a failed turn destroys the steer; Convex only clears it after a successful commit that actually incorporated it.

**Evidence:** runOneTurn: `const humanNote = room.pendingHuman ?? undefined; ... room.pendingHuman = null;` (lines 288-290) executes before `await generateAgentTurn(...)`. If the LLM or fetch throws, runLoop pushes 'turn failed' and stops — the steer is gone, and restarting produces turns without it. Convex: produceTurn passes consumedHuman through to commitAgentTurn, which clears it only on a landed commit and only if unchanged: `...(room.pendingHuman !== undefined && room.pendingHuman === args.consumedHuman ? { pendingHuman: undefined } : {})` (convex/rooms.ts:365); on a thrown turn markRunFailed never touches pendingHuman, so the steer survives and is incorporated on restart. Same loss on Node's manual /step 502 path.

**Suggested fix:** Defer clearing: capture humanNote, and only null room.pendingHuman after runOneTurn's commit block, guarded by `room.pendingHuman === humanNote` so a steer submitted mid-flight also survives (matching Convex).

## [18] LOW · convex/shared.ts:149 · intent_parsing

**Defect:** Common spoken count phrasings fail to retarget: 'count all the way to N' and 'count till N' both return null because the regex only allows the fixed optional fillers up/out loud/from between 'count' and to|through|until, and 'till' is missing from the connector alternation. Identical in src/live/steering.ts:91.

**Evidence:** Verified: "count all the way to fifty" => null and "count till twenty" => null (no goal override, no count task installed), while "count up to a hundred" => count-to-100 works. The text still reaches the agents as pendingHuman, so they may start counting conversationally — but without the count task there is no per-turn coercion or server-side target enforcement, which is the whole point of the count path.

**Suggested fix:** Broaden the connector alternation to (?:to|through|until|till|up\s+to) and replace the fixed filler list with a bounded non-greedy gap, e.g. \bcount(?:ing)?\b(?:\s+[\w-]+){0,4}?\s+(?:to|till|until|through)\s+..., keeping the existing negation/question guards from the other fixes.

## [19] LOW · src/live/roomServer.ts:290 · reducer_state

**Defect:** runOneTurn consumes pendingHuman (sets it to null) BEFORE the LLM call, so if generateAgentTurn throws, the human steer is permanently lost and the loop halts — the steer is never re-delivered on the next turn.

**Evidence:** Lines 288-290: `const humanNote = room.pendingHuman ?? undefined; ... room.pendingHuman = null;` precede `await generateAgentTurn(...)`. On an LLM error the exception propagates to runLoop's catch (lines 374-388) or /step's catch (line 595), which stop/report but never restore pendingHuman. Scenario: user says "keep the itinerary under $50" (a non-goal steer, so it lives only in pendingHuman); the very next LLM call 500s; the run halts and when the user restarts, the budget constraint is gone from state — it exists only as a transcript line the 12-message window will eventually scroll past. The Convex twin handles this correctly: commitAgentTurn clears pendingHuman only after a successful commit and only when it matches consumedHuman (rooms.ts:365).

**Suggested fix:** Clear pendingHuman only at commit time inside runOneTurn's reducer block (after generateAgentTurn succeeds), and only if `room.pendingHuman === humanNote` so a steer submitted mid-flight survives — mirroring the Convex consumedHuman pattern.

## [20] LOW · convex/rooms.ts:362 · reducer_state

**Defect:** Done semantics after target reached: neither commitAgentTurn nor stepOnce checks room.done, and countNext is clamped at target, so every manual step on a completed count room commits another turn that re-speaks the terminal number ('Ten', 'Ten', ...) while incrementing the turn counter.

**Evidence:** After completion the room has done=true, countNext=target (line 362 clamp: `countNext: Math.min(countTask.next + 1, countTask.target)`). stepOnce (coordinator.ts:100-108) has no done guard and commitAgentTurn's guards (rooms.ts:315-334) check only floor and token. On a stepped done room, produceTurn builds countTask {target, next:target}; coerceCountTurn (shared.ts:135-145) forces text = numberToWords(target) and done=true; the commit inserts the duplicate utterance, bumps turn, and flips the floor, so alternating agents keep repeating the final number on every step. The node /step has the identical hole (roomServer.ts:587 checks busy/running but not room.state.done; the line-331 clamp keeps countNext pinned at target).

**Suggested fix:** Refuse manual steps on done rooms (return {ok:false, reason:'done'} from stepOnce / 409 from node /step), or have commitAgentTurn reject when `room.done && currentCountTask(room)?.next >= target` so a completed count task cannot re-commit its terminal turn.

## [21] LOW · src/live/roomServer.ts:325 · transport_parity

**Defect:** Pausing mid-turn discards the in-flight turn on Convex but commits it on Node — pause-then-retarget still speaks and counts the stale pre-steer turn on Node only.

**Evidence:** Convex commitAgentTurn rejects stale hops: `if (args.token !== undefined && (!room.running || room.runToken !== args.token)) { ... return { committed: false, reason: "stale token / paused" }; }` (convex/rooms.ts:325-334) — the utterance is never inserted and its audio is deleted. Node's runOneTurn has no equivalent check: after the awaited LLM/TTS calls it unconditionally mutates state (`room.state.turn += 1`, floor flip, countNext advance, pushUtterance, broadcast 'speak', lines 325-351); runLoop only consults loopToken/running at iteration boundaries (lines 369, 391). A user who hits Stop (loopToken++, running=false) and immediately retargets still hears the stale turn land and sees countNext advance on Node, while Convex discards it.

**Suggested fix:** Capture room.loopToken at the top of runOneTurn and skip the reducer/commit block (returning uncommitted) if the token or running flag changed while the LLM/TTS calls were in flight.

## [22] LOW · src/live/roomServer.ts:327 · transport_parity

**Defect:** loopRisk fires after a single backchannel on Node (missing the length-2 requirement Convex has), so the first turn being a backchannel flags loopRisk=true on one transport and false on the other.

**Evidence:** Node: `room.state.loopRisk = room.state.recentActs.slice(-2).every((a) => a === "backchannel");` (line 327) — with one act in recentActs, slice(-2) has length 1 and every() returns true for a lone backchannel. Convex: `const loopRisk = recentActs.slice(-2).length === 2 && recentActs.slice(-2).every((a) => a === "backchannel");` (convex/rooms.ts:348) requires two consecutive backchannels. Both snapshots expose state.loopRisk identically to clients, so the UI badge behavior differs across transports for the first-turn/backchannel case.

**Suggested fix:** Add the same length check on Node: `const last2 = room.state.recentActs.slice(-2); room.state.loopRisk = last2.length === 2 && last2.every((a) => a === "backchannel");`

