import { describe, expect, it } from "vitest";
import { coerceCountTurn, deriveCountTask, deriveGoalOverrideFromHuman } from "../src/live/steering.js";

describe("live room steering", () => {
  it("promotes explicit count steers into the active room goal", () => {
    expect(deriveGoalOverrideFromHuman("count to 100")).toBe(
      "Count from 1 to 100 out loud, one number per agent turn, stopping exactly at 100.",
    );
    expect(deriveGoalOverrideFromHuman("please count to one hundred")).toBe(
      "Count from 1 to 100 out loud, one number per agent turn, stopping exactly at 100.",
    );
  });

  it("keeps constraint nudges as steers under the existing goal", () => {
    expect(deriveGoalOverrideFromHuman("keep the plan under 40 dollars total")).toBeNull();
  });

  it("derives and guards count task turns from room state", () => {
    const task = deriveCountTask("Count from 1 to 100 out loud, one number per agent turn, stopping exactly at 100.");
    expect(task).toEqual({ kind: "count_to_n", target: 100, next: 1 });

    expect(coerceCountTurn({ text: "Let's keep planning the picnic.", speechAct: "backchannel", done: false }, task!)).toEqual({
      text: "One",
      speechAct: "task_action",
      done: false,
    });

    expect(coerceCountTurn({ text: "one hundred", speechAct: "task_action", done: false }, { ...task!, next: 100 })).toEqual({
      text: "one hundred",
      speechAct: "task_action",
      done: true,
    });
  });
});
