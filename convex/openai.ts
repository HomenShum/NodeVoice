/**
 * OpenAI pipeline helpers for Convex actions. Keys come from Convex env
 * (`npx convex env set OPENAI_API_KEY …`) and never reach the client.
 */
import { coerceCountTurn, normalizeHumanSteeringIntent, type CapabilityProfile, type CountTask, type HumanSteeringIntent } from "./shared";

const OPENAI = "https://api.openai.com/v1";
const STT_MODEL = "whisper-1";
const OPENAI_TTS_MODEL = "gpt-4o-mini-tts";
const WEB_RESEARCH_MODEL = "gpt-4.1-mini";
const isNextGen = (m: string) => /^(gpt-5|o[1-9])/.test(m);

function key(): string {
  const k = process.env.OPENAI_API_KEY;
  if (!k) throw new Error("OPENAI_API_KEY not set on the Convex deployment");
  return k;
}

export interface TurnInput {
  goal: string;
  model: string;
  profile?: CapabilityProfile;
  persona: string;
  selfName: string;
  otherName: string;
  transcript: { name: string; text: string }[];
  humanNote?: string;
  recentActs: string[];
  countTask?: CountTask | null;
}

export interface TurnResult {
  text: string;
  speechAct: "task_action" | "backchannel" | "question";
  done: boolean;
}

export async function generateAgentTurn(input: TurnInput): Promise<TurnResult> {
  const forceAction = input.recentActs.slice(-2).filter((a) => a === "backchannel").length >= 2;
  const system = [
    `You are ${input.selfName}, one voice agent collaborating out loud in a shared room. The next scheduled peer is ${input.otherName}.`,
    `Persona: ${input.persona}`,
    input.profile ? `Capability profile: ${input.profile}.` : ``,
    `Shared goal: ${input.goal}`,
    input.countTask
      ? `Active count task: next=${input.countTask.next}, target=${input.countTask.target}. Say exactly the next number and no commentary. Set done=true only when you say the target.`
      : ``,
    input.humanNote ? `The latest human steer supersedes earlier transcript turns if they conflict.` : ``,
    `Say ONE short spoken turn (1-2 sentences, conversational, no lists/markdown), read aloud by TTS.`,
    `Make concrete progress; build on ${input.otherName}; never produce an empty acknowledgement.`,
    forceAction ? `The last turns were low-content acknowledgements — you MUST take a substantive task_action now.` : ``,
    input.humanNote ? `A human just steered the room: "${input.humanNote}". Incorporate it directly.` : ``,
    `When the goal is genuinely achieved, set done=true with a crisp closing summary.`,
    `Respond ONLY as JSON: {"text": string, "speechAct": "task_action"|"question"|"backchannel", "done": boolean}`,
  ]
    .filter(Boolean)
    .join("\n");
  const convo = input.transcript.slice(-12).map((m) => `${m.name}: ${m.text}`).join("\n");
  const nextgen = isNextGen(input.model);

  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 30_000);
  try {
    const r = await fetch(`${OPENAI}/chat/completions`, {
      method: "POST",
      headers: { authorization: `Bearer ${key()}`, "content-type": "application/json" },
      signal: ctrl.signal,
      body: JSON.stringify({
        model: input.model,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: system },
          { role: "user", content: convo ? `Conversation so far:\n${convo}\n\nYour turn (${input.selfName}):` : `Open the collaboration (${input.selfName}):` },
        ],
        ...(nextgen ? { max_completion_tokens: 1500, reasoning_effort: "low" } : { temperature: 0.8, max_tokens: 200 }),
      }),
    });
    if (!r.ok) throw new Error(`llm ${r.status} ${(await r.text()).slice(0, 160)}`);
    const j = (await r.json()) as { choices?: { message?: { content?: string } }[] };
    let parsed: Partial<TurnResult> = {};
    try {
      parsed = JSON.parse(j.choices?.[0]?.message?.content ?? "{}");
    } catch {
      parsed = { text: "…", speechAct: "task_action", done: false };
    }
    const text = (parsed.text ?? "").toString().trim().slice(0, 400) || "…";
    const speechAct: TurnResult["speechAct"] = parsed.speechAct === "backchannel" || parsed.speechAct === "question" ? parsed.speechAct : "task_action";
    const turn: TurnResult = { text, speechAct, done: Boolean(parsed.done) };
    return input.countTask ? coerceCountTurn(turn, input.countTask) : turn;
  } finally {
    clearTimeout(t);
  }
}

export async function interpretHumanSteer(input: {
  text: string;
  currentGoal: string;
  model: string;
  profile?: CapabilityProfile;
  transcript: { name: string; text: string }[];
}): Promise<HumanSteeringIntent> {
  const nextgen = isNextGen(input.model);
  const system = [
    `You interpret human steering for a live multi-agent voice room.`,
    `Return only JSON. Do not write an agent reply.`,
    `Current goal: ${input.currentGoal}`,
    input.profile ? `Capability profile: ${input.profile}` : ``,
    ``,
    `Classify the human's latest utterance by intent, not by keyword.`,
    `Allowed JSON shapes:`,
    `{"kind":"count_task","start":number,"target":number,"confidence":number,"reason":string}`,
    `{"kind":"add_goal","goal":string,"confidence":number,"reason":string}`,
    `{"kind":"retarget","goal":string,"confidence":number,"reason":string}`,
    `{"kind":"constraint","note":string,"confidence":number,"reason":string}`,
    `{"kind":"question","question":string,"confidence":number,"reason":string}`,
    `{"kind":"control","action":"start"|"pause"|"resume"|"stop","confidence":number,"reason":string}`,
    `{"kind":"none","confidence":number,"reason":string}`,
    ``,
    `Use count_task when the human asks the agents to count, alternate, count one at a time, count up to N, or count from A to B.`,
    `Use add_goal when the human says "also", "in parallel", "at the same time", or asks for another independent workstream.`,
    `Use retarget when the human explicitly replaces/switches the current goal.`,
    `Use constraint for budget/style/process constraints that should steer the existing goal without replacing it.`,
    `Use none for approvals/backchannels like "sounds good" or "great".`,
  ]
    .filter(Boolean)
    .join("\n");
  const convo = input.transcript.slice(-10).map((m) => `${m.name}: ${m.text}`).join("\n");
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 12_000);
  try {
    const r = await fetch(`${OPENAI}/chat/completions`, {
      method: "POST",
      headers: { authorization: `Bearer ${key()}`, "content-type": "application/json" },
      signal: ctrl.signal,
      body: JSON.stringify({
        model: input.model,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: system },
          {
            role: "user",
            content: `${convo ? `Recent transcript:\n${convo}\n\n` : ""}Latest human utterance:\n${input.text}`,
          },
        ],
        ...(nextgen ? { max_completion_tokens: 1000, reasoning_effort: "low" } : { temperature: 0, max_tokens: 180 }),
      }),
    });
    if (!r.ok) throw new Error(`intent llm ${r.status} ${(await r.text()).slice(0, 160)}`);
    const j = (await r.json()) as { choices?: { message?: { content?: string } }[] };
    const parsed = JSON.parse(j.choices?.[0]?.message?.content ?? "{}") as unknown;
    return normalizeHumanSteeringIntent(parsed, input.text);
  } finally {
    clearTimeout(t);
  }
}

export interface V3WorkerOutput {
  title: string;
  content: string;
  summary: string;
  sources?: unknown[];
  model: string;
}

export async function runWebResearchWorker(input: {
  goal: string;
  task: string;
  roomGoal: string;
  model?: string;
}): Promise<V3WorkerOutput> {
  const model = process.env.OPENAI_WEB_MODEL || input.model || WEB_RESEARCH_MODEL;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 60_000);
  try {
    const r = await fetch(`${OPENAI}/responses`, {
      method: "POST",
      headers: { authorization: `Bearer ${key()}`, "content-type": "application/json" },
      signal: ctrl.signal,
      body: JSON.stringify({
        model,
        tools: [{ type: "web_search" }],
        include: ["web_search_call.action.sources"],
        instructions: [
          "You are a fast senior research worker inside a live multi-agent room.",
          "Use web search when current facts, market data, pricing, tools, or recent examples matter.",
          "Return concise markdown with citations or source names where available.",
          "Be direct, practical, and clear about uncertainty. Do not promise outcomes that cannot be guaranteed.",
        ].join("\n"),
        input: [
          `Room foreground goal: ${input.roomGoal}`,
          `Worker goal: ${input.goal}`,
          `Worker task: ${input.task}`,
          "",
          "Produce:",
          "1. Key current findings",
          "2. Actionable implications",
          "3. Concrete next steps",
          "4. Sources used",
        ].join("\n"),
      }),
    });
    if (!r.ok) throw new Error(`responses ${r.status} ${(await r.text()).slice(0, 240)}`);
    const j = (await r.json()) as Record<string, unknown>;
    const content = extractResponsesText(j).slice(0, 8000);
    if (!content.trim()) throw new Error("responses returned no text");
    return {
      title: `Research: ${input.goal.slice(0, 72)}`,
      content,
      summary: firstMeaningfulLine(content).slice(0, 220),
      sources: extractResponsesSources(j),
      model,
    };
  } finally {
    clearTimeout(t);
  }
}

export async function runPlanningWorker(input: {
  goal: string;
  task: string;
  roomGoal: string;
  model: string;
}): Promise<V3WorkerOutput> {
  const nextgen = isNextGen(input.model);
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 30_000);
  try {
    const r = await fetch(`${OPENAI}/chat/completions`, {
      method: "POST",
      headers: { authorization: `Bearer ${key()}`, "content-type": "application/json" },
      signal: ctrl.signal,
      body: JSON.stringify({
        model: input.model,
        messages: [
          {
            role: "system",
            content:
              "You are a senior execution planner worker. Produce a concise, concrete plan artifact. No motivational fluff. No fake claims. If the goal requests impossible guarantees, convert it into an execution plan with honest caveats.",
          },
          {
            role: "user",
            content: `Room foreground goal: ${input.roomGoal}\nWorker goal: ${input.goal}\nWorker task: ${input.task}\n\nReturn markdown with: objective, assumptions, task graph, first deliverable, verification plan, risks.`,
          },
        ],
        ...(nextgen ? { max_completion_tokens: 1800, reasoning_effort: "low" } : { temperature: 0.2, max_tokens: 900 }),
      }),
    });
    if (!r.ok) throw new Error(`planning llm ${r.status} ${(await r.text()).slice(0, 180)}`);
    const j = (await r.json()) as { choices?: { message?: { content?: string } }[] };
    const content = (j.choices?.[0]?.message?.content ?? "").trim().slice(0, 8000);
    if (!content) throw new Error("planning worker returned no text");
    return {
      title: `Plan: ${input.goal.slice(0, 76)}`,
      content,
      summary: firstMeaningfulLine(content).slice(0, 220),
      model: input.model,
    };
  } finally {
    clearTimeout(t);
  }
}

function extractResponsesText(value: unknown): string {
  if (!value || typeof value !== "object") return "";
  const record = value as Record<string, unknown>;
  if (typeof record.output_text === "string") return record.output_text;
  const output = Array.isArray(record.output) ? record.output : [];
  const chunks: string[] = [];
  for (const item of output) {
    if (!item || typeof item !== "object") continue;
    const content = (item as Record<string, unknown>).content;
    if (!Array.isArray(content)) continue;
    for (const part of content) {
      if (!part || typeof part !== "object") continue;
      const p = part as Record<string, unknown>;
      if (typeof p.text === "string") chunks.push(p.text);
      if (typeof p.output_text === "string") chunks.push(p.output_text);
    }
  }
  return chunks.join("\n\n");
}

function extractResponsesSources(value: unknown): unknown[] {
  if (!value || typeof value !== "object") return [];
  const output = Array.isArray((value as Record<string, unknown>).output) ? ((value as Record<string, unknown>).output as unknown[]) : [];
  const sources: unknown[] = [];
  for (const item of output) {
    if (!item || typeof item !== "object") continue;
    const record = item as Record<string, unknown>;
    if (record.type === "web_search_call" && record.action && typeof record.action === "object") {
      const action = record.action as Record<string, unknown>;
      if (Array.isArray(action.sources)) sources.push(...action.sources);
    }
  }
  return sources.slice(0, 12);
}

function firstMeaningfulLine(markdown: string): string {
  return markdown
    .split(/\r?\n/)
    .map((line) => line.replace(/^#+\s*/, "").trim())
    .find((line) => line && !/^[-*]\s*$/.test(line)) ?? "Worker completed.";
}

export async function synthesizeSpeech(text: string, voice: string): Promise<Blob> {
  const run = async (model: string) => {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 30_000);
    try {
      const r = await fetch(`${OPENAI}/audio/speech`, {
        method: "POST",
        headers: { authorization: `Bearer ${key()}`, "content-type": "application/json" },
        signal: ctrl.signal,
        body: JSON.stringify({ model, voice, input: text.slice(0, 800), response_format: "mp3" }),
      });
      if (!r.ok) throw new Error(`tts ${r.status} ${(await r.text()).slice(0, 140)}`);
      return new Blob([await r.arrayBuffer()], { type: "audio/mpeg" });
    } finally {
      clearTimeout(t);
    }
  };
  try {
    return await run(OPENAI_TTS_MODEL);
  } catch {
    return run("tts-1");
  }
}

export async function transcribeAudio(bytes: ArrayBuffer, mime: string): Promise<string> {
  const ext = mime.includes("webm") ? "webm" : mime.includes("mp4") ? "mp4" : mime.includes("ogg") ? "ogg" : "wav";
  const form = new FormData();
  form.append("file", new Blob([bytes], { type: mime || "audio/webm" }), `speech.${ext}`);
  form.append("model", STT_MODEL);
  form.append("response_format", "json");
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 30_000);
  try {
    const r = await fetch(`${OPENAI}/audio/transcriptions`, { method: "POST", headers: { authorization: `Bearer ${key()}` }, body: form, signal: ctrl.signal });
    if (!r.ok) throw new Error(`stt ${r.status} ${(await r.text()).slice(0, 140)}`);
    const j = (await r.json()) as { text?: string };
    return (j.text ?? "").trim();
  } finally {
    clearTimeout(t);
  }
}
