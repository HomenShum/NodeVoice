import { describe, expect, it } from "vitest";
import { extractNumber, numberToWords } from "../src/core/numberWords.js";
import { runSideBySideComparison } from "../src/compare/badGoodDemo.js";

// The product's headline claim is "count to 100 together". Every existing test
// counted to 6, so nothing ever spoke the word "hundred" and the suite stayed
// green while the demo on the landing page stalled at 99 forever.
describe("count to one hundred", () => {
  it("hears back every number it speaks, 1..100", () => {
    const deaf: Array<{ n: number; spoken: string; heard: number | undefined }> = [];
    for (let n = 1; n <= 100; n += 1) {
      const spoken = numberToWords(n);
      const heard = extractNumber(spoken);
      if (heard !== n) deaf.push({ n, spoken, heard });
    }
    expect(deaf).toEqual([]);
  });

  it("parses hundreds phrases as a whole phrase, not the first word", () => {
    expect(extractNumber("One hundred")).toBe(100);
    expect(extractNumber("one hundred and one")).toBe(101);
    expect(extractNumber("two hundred")).toBe(200);
    // unchanged behaviour that the phrase parser must not eat
    expect(extractNumber("a hundred")).toBe(100);
    expect(extractNumber("Ninety-nine")).toBe(99);
    expect(extractNumber("100")).toBe(100);
    expect(extractNumber("seven eight")).toBe(7); // two utterances, not 15
    expect(extractNumber("let's do this")).toBeUndefined();
  });

  it("finishes the shared-room demo at its shipped default target of 100", async () => {
    const result = await runSideBySideComparison({ target: 100, turns: 100, useOllama: false });
    expect(result.good.at(-1)?.current).toBe(100);
    expect(result.goodFinalState.task.completed).toBe(true);
  }, 30_000);
});
