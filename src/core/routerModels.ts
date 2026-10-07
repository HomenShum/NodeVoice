/**
 * The models a room may be pointed at, with what each one costs and how long it
 * takes. A person running a room picks one from a dropdown; the numbers are
 * measurements from `scripts/model-eval.mjs`, not vendor claims, so the picker
 * can honestly say "this one answers in about a second".
 *
 * One table, read by the local Node server and the hosted Convex backend alike.
 */

export const ROUTER_MODELS = [
  { id: "gpt-5.4-mini", label: "GPT-5.4 mini", tier: "smart + fast", note: "default · smartest mini that stays ~1.3s", expectedLatencyMs: 1300, expectedCostUsd: 0.0007164375, qualityScore: 4.75 },
  { id: "gpt-4.1-nano", label: "GPT-4.1 nano", tier: "cheapest", note: "fastest (~0.7s) + cheapest", expectedLatencyMs: 700, expectedCostUsd: 0.000033425, qualityScore: 4.15 },
  { id: "gpt-4.1-mini", label: "GPT-4.1 mini", tier: "balanced", note: "fast, mid capability", expectedLatencyMs: 700, expectedCostUsd: 0.0001409, qualityScore: 4.1 },
  { id: "gpt-4o-mini", label: "GPT-4o mini", tier: "legacy", note: "older baseline", expectedLatencyMs: 1000, expectedCostUsd: 0.0000505875, qualityScore: 4.5 },
  { id: "gpt-5-nano", label: "GPT-5 nano", tier: "cheap + smart", note: "smart but ~3s (reasoning)", expectedLatencyMs: 3200, expectedCostUsd: 0.0001320625, qualityScore: 4.6 },
  { id: "gpt-5-mini", label: "GPT-5 mini", tier: "max quality", note: "top quality, ~3s+ (reasoning)", expectedLatencyMs: 3000, expectedCostUsd: 0.0007873125, qualityScore: 5 },
] as const;

export const DEFAULT_MODEL = "gpt-5.4-mini";

/** Never let a caller-supplied model id through unchecked. */
export function validModel(m?: string): string {
  return m && ROUTER_MODELS.some((x) => x.id === m) ? m : DEFAULT_MODEL;
}
