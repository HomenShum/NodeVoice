import { describe, expect, it } from "vitest";
import * as convexSteering from "../convex/shared.js";
import * as liveSteering from "../src/live/steering.js";

const steeringCopies = [
  ["node", liveSteering],
  ["convex", convexSteering],
] as const;

function countGoal(start: number, target: number): string {
  return `Count from ${start} to ${target} out loud, one number per agent turn, stopping exactly at ${target}.`;
}

function expectOverride(text: string, expected: string | null) {
  for (const [name, steering] of steeringCopies) {
    expect(steering.deriveGoalOverrideFromHuman(text), name).toBe(expected);
  }
}

function expectCountTask(goal: string, expected: { target: number; next: number } | null, next?: number) {
  for (const [name, steering] of steeringCopies) {
    const task = steering.deriveCountTask(goal, next);
    expect(task, name).toEqual(expected ? { kind: "count_to_n", ...expected } : null);
  }
}

describe("live room steering", () => {
  it("keeps the Convex and Node steering parsers in parity", () => {
    const cases = [
      "count to 100",
      "please count to one hundred",
      "count to five, then take 2 minutes to reflect",
      "don't count to ten, count to twenty",
      "new goal: write a song about counting to ten",
      "new goal: count from 50 to 60",
      "45 to 60. Hey, I actually want you to count to 10 instead of talking about this.",
      "Now I want you guys to each count one at a time up to 50 and then make sure you guys don't overlap.",
      "count all the way to fifty",
      "count till twenty",
      "actually that plan sounds great",
      "are we counting to twenty or thirty?",
    ];

    for (const text of cases) {
      expect(liveSteering.deriveGoalOverrideFromHuman(text)).toBe(convexSteering.deriveGoalOverrideFromHuman(text));
    }
  });

  it("rotates active agent slots for expanded live rooms", () => {
    expect(convexSteering.activeSlots(2)).toEqual(["agent-001", "agent-002"]);
    expect(convexSteering.activeSlots(5)).toEqual(["agent-001", "agent-002", "agent-003", "agent-004", "agent-005"]);
    expect(convexSteering.activeSlots(100)).toHaveLength(100);
    expect(convexSteering.nextSlot("agent-001", 3)).toBe("agent-002");
    expect(convexSteering.nextSlot("agent-002", 3)).toBe("agent-003");
    expect(convexSteering.nextSlot("agent-003", 3)).toBe("agent-001");
    expect(convexSteering.nextSlot("a", 3)).toBe("agent-002");
    expect(convexSteering.validAgentCount(1)).toBe(1);
    expect(convexSteering.validAgentCount(99)).toBe(99);
    expect(convexSteering.validAgentCount(101)).toBe(100);
  });

  it("promotes explicit count steers into the active room goal", () => {
    expectOverride("count to 100", countGoal(1, 100));
    expectOverride("please count to one hundred", countGoal(1, 100));
    expectOverride("count all the way to fifty", countGoal(1, 50));
    expectOverride("count till twenty", countGoal(1, 20));
  });

  it("does not let later digits hijack the count target", () => {
    expectOverride("count to five, then take 2 minutes to reflect", countGoal(1, 5));
    expectOverride("count to ten, we have 30 seconds", countGoal(1, 10));
  });

  it("ignores negated count clauses and interrogatives", () => {
    expectOverride("don't count to ten, count to twenty", countGoal(1, 20));
    expectOverride("please don't count to 100", null);
    expectOverride("are we counting to twenty or thirty?", null);
  });

  it("honors explicit goal text before looking for count commands", () => {
    expectOverride("new goal: write a song about counting to ten", "write a song about counting to ten");
    expectOverride("new goal: count from 50 to 60", countGoal(50, 60));
  });

  it("recognizes conversational retargets into count goals", () => {
    expectOverride("45 to 60. Hey, I actually want you to count to 10 instead of talking about this.", countGoal(1, 10));
    expectOverride("Now I want you guys to each count one at a time up to 50 and then make sure you guys don't overlap.", countGoal(1, 50));
  });

  it("keeps approval language from becoming a new goal", () => {
    expectOverride("actually that plan sounds great", null);
    expectOverride("actually plan a picnic in Golden Gate Park", "plan a picnic in Golden Gate Park");
  });

  it("derives and guards count task turns from room state", () => {
    expectCountTask(countGoal(1, 100), { target: 100, next: 1 });
    expectCountTask(countGoal(50, 60), { target: 60, next: 50 });
    expectCountTask(countGoal(50, 60), { target: 60, next: 55 }, 55);
    expectCountTask(countGoal(50, 60), { target: 60, next: 50 }, 1);

    const task = liveSteering.deriveCountTask(countGoal(1, 100));
    expect(task).toEqual({ kind: "count_to_n", target: 100, next: 1 });

    expect(liveSteering.coerceCountTurn({ text: "Let's keep planning the picnic.", speechAct: "backchannel", done: false }, task!)).toEqual({
      text: "One",
      speechAct: "task_action",
      done: false,
    });

    expect(liveSteering.coerceCountTurn({ text: "one hundred", speechAct: "task_action", done: false }, { ...task!, next: 100 })).toEqual({
      text: "one hundred",
      speechAct: "task_action",
      done: true,
    });

    expect(liveSteering.coerceCountTurn({ text: "wrong number", speechAct: "backchannel", done: false }, { kind: "count_to_n", target: 60, next: 50 })).toEqual({
      text: "Fifty",
      speechAct: "task_action",
      done: false,
    });
  });

  it("keeps constraint nudges as steers under the existing goal", () => {
    expectOverride("keep the plan under 40 dollars total", null);
  });

  it("normalizes LLM steering intents into reducer-safe goals", () => {
    for (const [name, steering] of steeringCopies) {
      expect(steering.validProfile("v0_no_room_state"), name).toBe("v0_no_room_state");
      expect(steering.validProfile("missing"), name).toBe("v1_room_state");
      expect(steering.profileUsesRoomState("v0_no_room_state"), name).toBe(false);

      const countIntent = steering.normalizeHumanSteeringIntent(
        { kind: "count_task", start: 1, target: 50, confidence: 0.92 },
        "count to fifty",
      );
      expect(countIntent, name).toMatchObject({ kind: "count_task", start: 1, target: 50 });
      expect(steering.goalFromHumanSteeringIntent(countIntent), name).toBe(countGoal(1, 50));

      const retarget = steering.normalizeHumanSteeringIntent(
        { kind: "retarget", goal: "write a song about counting to ten", confidence: 0.9 },
        "new goal",
      );
      expect(steering.goalFromHumanSteeringIntent(retarget), name).toBe("write a song about counting to ten");

      const approval = steering.normalizeHumanSteeringIntent({ kind: "none", confidence: 0.8 }, "actually that plan sounds great");
      expect(steering.goalFromHumanSteeringIntent(approval), name).toBeNull();
    }
  });

  it("falls back to typed intent when the LLM result is malformed", () => {
    for (const [name, steering] of steeringCopies) {
      const intent = steering.normalizeHumanSteeringIntent({ kind: "count_task", target: "oops" }, "count from 50 to 60");
      expect(intent, name).toMatchObject({ kind: "count_task", start: 50, target: 60 });
      expect(steering.goalFromHumanSteeringIntent(intent), name).toBe(countGoal(50, 60));
    }
  });
});
