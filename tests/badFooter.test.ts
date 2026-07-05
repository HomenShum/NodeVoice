import { describe, expect, it } from "vitest";
import { BAD_FOOTER_STUCK, badPeakBelief, deriveBadFooter } from "../src/compare/badFooter.js";
import { runSideBySideComparison } from "../src/compare/badGoodDemo.js";

/**
 * The footer is the demo's honesty seam: it must read from real agent state,
 * not from a hardcoded string or the source label. These tests pin BOTH
 * branches — the deterministic stall keeps the exact old wording, and a run
 * that progressed then looped tells the truth about how far it got.
 */
describe("deriveBadFooter", () => {
  it("keeps the EXACT original wording when the run genuinely stalls at 1", () => {
    // Deterministic scripted mode: believesCurrent peaks at 1 and never passes.
    const stalled = [
      { agentStates: [{ believesCurrent: 0 }, { believesCurrent: 0 }, { believesCurrent: 0 }] },
      { agentStates: [{ believesCurrent: 1 }, { believesCurrent: 1 }, { believesCurrent: 0 }] },
      { agentStates: [{ believesCurrent: 1 }, { believesCurrent: 1 }, { believesCurrent: 1 }] },
    ];
    expect(badPeakBelief(stalled)).toBe(1);
    expect(deriveBadFooter(stalled)).toBe(BAD_FOOTER_STUCK);
    expect(deriveBadFooter(stalled)).toBe("3 iPhones + 3 transcripts + no state = stuck at 1");
  });

  it("tells the truth when agents progressed past 1 then looped without completing", () => {
    // openai/ollama mode: a run that climbed to 12 (as verified live) then looped.
    const progressed = [
      { agentStates: [{ believesCurrent: 1 }, { believesCurrent: 1 }, { believesCurrent: 1 }] },
      { agentStates: [{ believesCurrent: 7 }, { believesCurrent: 5 }, { believesCurrent: 6 }] },
      { agentStates: [{ believesCurrent: 12 }, { believesCurrent: 11 }, { believesCurrent: 12 }] },
      // regressed on the final turn — peak (12), not the last value, is the truth
      { agentStates: [{ believesCurrent: 1 }, { believesCurrent: 1 }, { believesCurrent: 12 }] },
    ];
    expect(badPeakBelief(progressed)).toBe(12);
    expect(deriveBadFooter(progressed)).toBe(
      "3 transcripts, no shared state — counted to 12, then looped (no authority to stop)",
    );
    expect(deriveBadFooter(progressed)).not.toContain("stuck at 1");
  });

  it("branches on believesCurrent, not the source string (empty / missing states → original)", () => {
    expect(deriveBadFooter([])).toBe(BAD_FOOTER_STUCK);
    expect(deriveBadFooter([{}, { agentStates: [] }])).toBe(BAD_FOOTER_STUCK);
  });

  it("matches the real deterministic comparison output — keyless path stays 'stuck at 1'", async () => {
    // End-to-end guard: the actual scripted run must still map to the old copy.
    const result = await runSideBySideComparison({ target: 12, turns: 9, source: "deterministic" });
    expect(result.provenance.mode).toBe("deterministic");
    expect(deriveBadFooter(result.bad)).toBe(BAD_FOOTER_STUCK);
  });
});
