#!/usr/bin/env node
/**
 * Proofloop: an empirical, reproducible eval of candidate room-coordinator LLMs.
 *
 *   node scripts/model-eval.mjs
 *
 * For each model × scenario it runs the room's real request shape, measures
 * latency + token cost, and has a strong judge model score the reply on a
 * rubric (specificity / progress / non-looping / instruction-following /
 * naturalness). Writes docs/model-eval-results.json and prints a table.
 *
 * Reads OPENAI_API_KEY from .env.local. Costs a few cents to run.
 */
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const env = fs.readFileSync(resolve(root, ".env.local"), "utf8");
const KEY = env.match(/OPENAI_API_KEY=(.+)/)?.[1]?.trim();
if (!KEY) throw new Error("OPENAI_API_KEY missing from .env.local");

// candidate coordinator models — [inputPrice, outputPrice] per 1M tokens
const MODELS = [
  { id: "gpt-4o-mini", nextgen: false, price: [0.15, 0.6] },
  { id: "gpt-4.1-nano", nextgen: false, price: [0.1, 0.4] },
  { id: "gpt-4.1-mini", nextgen: false, price: [0.4, 1.6] },
  { id: "gpt-5-nano", nextgen: true, price: [0.05, 0.4] },
  { id: "gpt-5-mini", nextgen: true, price: [0.25, 2.0] },
  { id: "gpt-5.4-mini", nextgen: true, price: [0.75, 4.5] },
];
const JUDGE = "gpt-5.4";

const SYSTEM = (self, other, goal, humanNote, forceAction) =>
  [
    `You are ${self}, one of two voice agents collaborating out loud with ${other} on: ${goal}`,
    `Say ONE short spoken turn (1-2 sentences, conversational, no lists/markdown), read aloud by TTS.`,
    `Make concrete progress; build on ${other}; never produce an empty acknowledgement.`,
    forceAction ? `The last turns were low-content acknowledgements — you MUST take a substantive task_action now.` : ``,
    humanNote ? `A human just steered the room: "${humanNote}". Incorporate it directly.` : ``,
    `When the goal is genuinely achieved, set done=true with a crisp closing summary.`,
    `Respond ONLY as JSON: {"text": string, "speechAct": "task_action"|"question"|"backchannel", "done": boolean}`,
  ]
    .filter(Boolean)
    .join("\n");

const SCENARIOS = [
  {
    name: "planning-constraints",
    probe: "concrete, on-budget, walkable progress",
    self: "Ada",
    other: "Ben",
    goal: "Plan a cheap SF Saturday for two friends, $60 total budget, walkable, agree a 3-stop itinerary.",
    convo: [{ name: "Ben", text: "Love it — where do we start, and how do we keep it under $60?" }],
  },
  {
    name: "loop-trap",
    probe: "refuses to just acknowledge; takes a substantive action",
    self: "Ben",
    other: "Ada",
    goal: "Decide one specific board game to play tonight and who brings snacks.",
    convo: [
      { name: "Ada", text: "Yeah, sounds good, let's do that." },
      { name: "Ben", text: "Exactly, I'm aligned, works for me." },
    ],
    forceAction: true,
  },
  {
    name: "human-steer",
    probe: "adheres to an injected human constraint",
    self: "Ada",
    other: "Ben",
    goal: "Pick a dinner spot for four people downtown.",
    convo: [{ name: "Ben", text: "How about that steakhouse on 2nd?" }],
    humanNote: "Two of us are vegetarian and we all hate loud places.",
  },
  {
    name: "convergence",
    probe: "recognizes completion and closes cleanly (done=true)",
    self: "Ben",
    other: "Ada",
    goal: "Agree a 2-stop evening: tacos at La Taqueria then a walk at Dolores Park.",
    convo: [
      { name: "Ada", text: "So: 6pm tacos at La Taqueria (~$15 each), then sunset at Dolores Park." },
      { name: "Ben", text: "That fits the budget and it's walkable between them." },
    ],
  },
];

async function chat(model, nextgen, messages, extra = {}) {
  const t0 = Date.now();
  const body = {
    model,
    response_format: { type: "json_object" },
    messages,
    ...(nextgen ? { max_completion_tokens: 1500, reasoning_effort: extra.effort ?? "low" } : { temperature: extra.temp ?? 0.8, max_tokens: 250 }),
  };
  const r = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { authorization: `Bearer ${KEY}`, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const ms = Date.now() - t0;
  if (!r.ok) return { ok: false, ms, err: `${r.status} ${(await r.text()).slice(0, 160)}` };
  const j = await r.json();
  return { ok: true, ms, content: j.choices?.[0]?.message?.content ?? "", usage: j.usage ?? {} };
}

async function generate(model, sc) {
  const messages = [
    { role: "system", content: SYSTEM(sc.self, sc.other, sc.goal, sc.humanNote, sc.forceAction) },
    { role: "user", content: `Conversation so far:\n${sc.convo.map((m) => `${m.name}: ${m.text}`).join("\n")}\n\nYour turn (${sc.self}):` },
  ];
  const res = await chat(model.id, model.nextgen, messages);
  if (!res.ok) return { model: model.id, scenario: sc.name, ok: false, err: res.err, ms: res.ms };
  let parsed = {};
  try { parsed = JSON.parse(res.content); } catch { parsed = { text: res.content }; }
  const pt = res.usage.prompt_tokens ?? 0;
  const ct = res.usage.completion_tokens ?? 0;
  const rt = res.usage.completion_tokens_details?.reasoning_tokens ?? 0;
  const cost = (pt * model.price[0] + ct * model.price[1]) / 1e6;
  return { model: model.id, scenario: sc.name, ok: true, ms: res.ms, text: parsed.text ?? "", speechAct: parsed.speechAct, done: !!parsed.done, promptTokens: pt, completionTokens: ct, reasoningTokens: rt, costPerTurn: cost };
}

async function judge(gen, sc) {
  if (!gen.ok) return { ...gen, score: 0 };
  const messages = [
    {
      role: "system",
      content: `You are a strict evaluator of a voice agent's single spoken turn in a collaborative room. Goal: ${sc.goal}. What this turn is testing: ${sc.probe}. Score each 1-5 (5=best): specificity (concrete names/numbers vs vague), progress (advances the goal), non_looping (substantive, not an empty acknowledgement), following (valid 1-2 sentence spoken JSON, on-constraint), naturalness (sounds like natural speech). Respond ONLY JSON: {"specificity":n,"progress":n,"non_looping":n,"following":n,"naturalness":n,"note":"<8 words"}`,
    },
    { role: "user", content: `Agent said: "${gen.text}" (speechAct=${gen.speechAct}, done=${gen.done})` },
  ];
  const res = await chat(JUDGE, true, messages, { effort: "medium" });
  if (!res.ok) return { ...gen, score: 0, judgeErr: res.err };
  let s = {};
  try { s = JSON.parse(res.content); } catch { /* ignore */ }
  const dims = ["specificity", "progress", "non_looping", "following", "naturalness"];
  const vals = dims.map((d) => Number(s[d]) || 0);
  const score = vals.reduce((a, b) => a + b, 0) / dims.length;
  return { ...gen, ...Object.fromEntries(dims.map((d, i) => [d, vals[i]])), score: Number(score.toFixed(2)), judgeNote: s.note };
}

async function main() {
  console.log(`Proofloop: ${MODELS.length} models × ${SCENARIOS.length} scenarios, judge=${JUDGE}\n`);
  const gens = (await Promise.all(MODELS.flatMap((m) => SCENARIOS.map((sc) => generate(m, sc))))).flat();
  const judged = await Promise.all(gens.map((g) => judge(g, SCENARIOS.find((s) => s.name === g.scenario))));

  // aggregate per model
  const byModel = MODELS.map((m) => {
    const rows = judged.filter((j) => j.model === m.id);
    const ok = rows.filter((r) => r.ok);
    const avg = (f) => (ok.length ? ok.reduce((a, r) => a + (r[f] || 0), 0) / ok.length : 0);
    return {
      model: m.id,
      quality: Number(avg("score").toFixed(2)),
      p50ms: Math.round(median(ok.map((r) => r.ms))),
      costPerTurn: avg("costPerTurn"),
      avgReasoning: Math.round(avg("reasoningTokens")),
      fails: rows.length - ok.length,
    };
  }).sort((a, b) => b.quality - a.quality);

  const out = { ranAt: new Date().toISOString?.() ?? Date.now(), judge: JUDGE, byModel, detail: judged };
  fs.writeFileSync(resolve(root, "docs/model-eval-results.json"), JSON.stringify(out, null, 2));

  console.log("model            quality  p50 latency  $/turn      reasoning  fails");
  console.log("─".repeat(72));
  for (const r of byModel) {
    console.log(
      `${r.model.padEnd(16)} ${String(r.quality).padStart(5)}    ${String(r.p50ms).padStart(7)}ms  $${r.costPerTurn.toFixed(6)}  ${String(r.avgReasoning).padStart(6)}     ${r.fails}`,
    );
  }
  console.log("\n→ docs/model-eval-results.json");
}

function median(xs) {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}

main().catch((e) => { console.error("eval failed:", e.message); process.exit(1); });
