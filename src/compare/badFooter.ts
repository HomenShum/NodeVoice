/**
 * Pure derivation of the bad-panel bottom status bar.
 *
 * Lives here (no imports) instead of in the client so it is covered by the
 * root tsconfig + vitest and stays browser-safe (no provider/node deps leak
 * into the bundle). Both src/client/App.tsx and tests/ import this.
 *
 * The footer must reflect what the run actually did, not a fixed string. It
 * reads the SAME signal the left private-state inspector reads: the highest
 * number any bad agent ever privately believed (believesCurrent).
 *
 * - Deterministic scripted mode: believesCurrent never passes 1, so the peak
 *   is ≤1 and we keep the EXACT original "stuck at 1" copy — nothing changes.
 * - openai / ollama mode: real model output can climb (verified 1→12 live)
 *   before looping without completing, so we tell the truth about the peak.
 *
 * Branching on believesCurrent (a real value) rather than the source string is
 * what keeps the deterministic-vs-progressed split honest.
 */

/** Minimal shape needed here — a structural subset of BadAgentPrivateState. */
export type BadFooterAgentState = { believesCurrent: number };

/** Minimal shape needed here — a structural subset of the compare step. */
export type BadFooterStep = { agentStates?: BadFooterAgentState[] };

/** Original wording — preserved verbatim for the deterministic stall. */
export const BAD_FOOTER_STUCK = "3 iPhones + 3 transcripts + no state = stuck at 1";

/** Highest number any bad agent ever privately believed across the whole run. */
export function badPeakBelief(steps: readonly BadFooterStep[]): number {
  let peak = 0;
  for (const step of steps) {
    for (const s of step.agentStates ?? []) {
      if (s.believesCurrent > peak) peak = s.believesCurrent;
    }
  }
  return peak;
}

export function deriveBadFooter(steps: readonly BadFooterStep[]): string {
  const peak = badPeakBelief(steps);
  if (peak <= 1) return BAD_FOOTER_STUCK;
  return `3 transcripts, no shared state — counted to ${peak}, then looped (no authority to stop)`;
}
