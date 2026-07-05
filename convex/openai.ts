/**
 * OpenAI pipeline helpers for Convex actions. Keys come from Convex env
 * (`npx convex env set OPENAI_API_KEY …`) and never reach the client.
 */
const OPENAI = "https://api.openai.com/v1";
const STT_MODEL = "whisper-1";
const OPENAI_TTS_MODEL = "gpt-4o-mini-tts";
const isNextGen = (m: string) => /^(gpt-5|o[1-9])/.test(m);

function key(): string {
  const k = process.env.OPENAI_API_KEY;
  if (!k) throw new Error("OPENAI_API_KEY not set on the Convex deployment");
  return k;
}

export interface TurnInput {
  goal: string;
  model: string;
  persona: string;
  selfName: string;
  otherName: string;
  transcript: { name: string; text: string }[];
  humanNote?: string;
  recentActs: string[];
}

export interface TurnResult {
  text: string;
  speechAct: "task_action" | "backchannel" | "question";
  done: boolean;
}

export async function generateAgentTurn(input: TurnInput): Promise<TurnResult> {
  const forceAction = input.recentActs.slice(-2).filter((a) => a === "backchannel").length >= 2;
  const system = [
    `You are ${input.selfName}, one of two voice agents collaborating out loud with ${input.otherName}.`,
    `Persona: ${input.persona}`,
    `Shared goal: ${input.goal}`,
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
    const speechAct = parsed.speechAct === "backchannel" || parsed.speechAct === "question" ? parsed.speechAct : "task_action";
    return { text, speechAct, done: Boolean(parsed.done) };
  } finally {
    clearTimeout(t);
  }
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
