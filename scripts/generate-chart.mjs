#!/usr/bin/env node
/**
 * Renders docs/model-chart.svg — a quality-vs-latency scatter of the router
 * models. Quality/cost come from scripts/model-eval.mjs; latency is the clean
 * single-turn median (parallel eval latency is inflated by contention).
 */
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

// [label, quality (proofloop 1-5), clean single-turn latency s, $/turn, highlight]
const DATA = [
  ["gpt-5.4-mini", 4.75, 1.27, 0.00072, "default"],
  ["gpt-4.1-nano", 4.15, 0.72, 0.000033, "cheapest"],
  ["gpt-4.1-mini", 4.1, 0.74, 0.00014, ""],
  ["gpt-4o-mini", 4.5, 1.02, 0.000051, ""],
  ["gpt-5-nano", 4.6, 3.15, 0.00013, ""],
  ["gpt-5-mini", 5.0, 3.0, 0.00079, ""],
];

const W = 720, H = 440, M = { l: 64, r: 24, t: 56, b: 56 };
const iw = W - M.l - M.r, ih = H - M.t - M.b;
const xMin = 0.4, xMax = 3.4, yMin = 3.9, yMax = 5.1;
const px = (x) => M.l + ((x - xMin) / (xMax - xMin)) * iw;
const py = (y) => M.t + ih - ((y - yMin) / (yMax - yMin)) * ih;

const C = { bg: "#0a0d12", panel: "#10141b", grid: "#1c2230", text: "#e4e8ee", mute: "#8b93a5", primary: "#7c6cf5", success: "#2fd08a", amber: "#f5b544" };

let els = "";
// grid + axes
for (let gx = 0.5; gx <= 3.5; gx += 0.5) els += `<line x1="${px(gx)}" y1="${M.t}" x2="${px(gx)}" y2="${M.t + ih}" stroke="${C.grid}" stroke-width="1"/><text x="${px(gx)}" y="${M.t + ih + 20}" fill="${C.mute}" font-size="11" text-anchor="middle">${gx}s</text>`;
for (let gy = 4; gy <= 5; gy += 0.5) els += `<line x1="${M.l}" y1="${py(gy)}" x2="${M.l + iw}" y2="${py(gy)}" stroke="${C.grid}" stroke-width="1"/><text x="${M.l - 10}" y="${py(gy) + 4}" fill="${C.mute}" font-size="11" text-anchor="end">${gy}</text>`;

// sweet-spot band (fast + smart)
els += `<rect x="${px(xMin)}" y="${py(yMax)}" width="${px(1.6) - px(xMin)}" height="${py(4.3) - py(yMax)}" fill="${C.success}" opacity="0.06"/>`;
els += `<text x="${px(0.75)}" y="${py(5.03)}" fill="${C.success}" font-size="11" font-weight="600" opacity="0.8">◱ fast + smart</text>`;

// points
for (const [label, q, lat, cost, hl] of DATA) {
  const cx = px(lat), cy = py(q);
  const r = 6 + Math.sqrt(cost) * 130; // bubble ∝ cost
  const col = hl === "default" ? C.primary : hl === "cheapest" ? C.success : C.mute;
  els += `<circle cx="${cx}" cy="${cy}" r="${r.toFixed(1)}" fill="${col}" opacity="${hl ? 0.85 : 0.5}" stroke="${col}" stroke-width="1.5"/>`;
  const anchor = cx > W - 150 ? "end" : "start";
  const dx = anchor === "end" ? -(r + 6) : r + 6;
  els += `<text x="${cx + dx}" y="${cy - 2}" fill="${C.text}" font-size="12" font-weight="${hl ? 700 : 500}" text-anchor="${anchor}">${label}${hl ? ` · ${hl}` : ""}</text>`;
  els += `<text x="${cx + dx}" y="${cy + 12}" fill="${C.mute}" font-size="10" text-anchor="${anchor}">$${cost.toFixed(6)}/turn</text>`;
}

const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" font-family="Inter,system-ui,sans-serif">
<rect width="${W}" height="${H}" rx="14" fill="${C.bg}"/>
<text x="${M.l}" y="30" fill="${C.text}" font-size="16" font-weight="700">Room coordinator models — quality vs. latency</text>
<text x="${M.l}" y="46" fill="${C.mute}" font-size="11">proofloop quality (judge, 1–5) · clean single-turn latency · bubble ∝ $/turn · lower-right of the band = best for live voice</text>
${els}
<text x="${M.l + iw / 2}" y="${H - 12}" fill="${C.mute}" font-size="12" text-anchor="middle">single-turn latency →</text>
<text x="16" y="${M.t + ih / 2}" fill="${C.mute}" font-size="12" text-anchor="middle" transform="rotate(-90 16 ${M.t + ih / 2})">quality →</text>
</svg>`;

fs.writeFileSync(resolve(root, "docs/model-chart.svg"), svg);
console.log("wrote docs/model-chart.svg");
