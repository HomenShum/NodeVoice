/**
 * Voice pipeline: Whisper (STT) → chat LLM → ElevenLabs (TTS).
 * All keys are read from the server environment at call time and never leave
 * the server. Every external call is bounded (AbortController timeout) and
 * response bodies are size-capped.
 */

const OPENAI = "https://api.openai.com/v1";
const ELEVEN = "https://api.elevenlabs.io/v1";

const STT_MODEL = process.env.STT_MODEL ?? "whisper-1";
// gpt-5.4-mini: latest, smartest mini, and — measured — as fast as gpt-4.1-nano
// (~1.4s/turn, 0 reasoning tokens on short conversational turns). Output price is
// higher but at ~70 tokens/turn it is dwarfed by STT/TTS cost. For the cheapest
// option instead, set OPENAI_MODEL=gpt-4.1-nano.
const LLM_MODEL = process.env.OPENAI_MODEL ?? "gpt-5.4-mini";
// gpt-5.x / o-series reasoning models use a different param shape and take a
// reasoning_effort. Keep it low so the voice loop stays snappy.
const REASONING_EFFORT = process.env.REASONING_EFFORT ?? "low";
const TTS_PROVIDER = (process.env.TTS_PROVIDER ?? "openai").toLowerCase(); // "openai" | "elevenlabs"
const OPENAI_TTS_MODEL = process.env.OPENAI_TTS_MODEL ?? "gpt-4o-mini-tts";
const ELEVEN_TTS_MODEL = process.env.ELEVENLABS_MODEL ?? "eleven_flash_v2_5";

const MAX_TTS_BYTES = 5 * 1024 * 1024; // 5 MB audio cap
const MAX_STT_BYTES = 20 * 1024 * 1024; // Whisper hard limit is 25 MB

export interface AgentTurnInput {
  goal: string;
  persona: string;
  otherName: string;
  selfName: string;
  transcript: { name: string; text: string }[];
  humanNote?: string;
  recentActs: string[];
  model?: string;
}

/** Curated router models (backed by scripts/model-eval.mjs measurements). */
export const ROUTER_MODELS = [
  { id: "gpt-5.4-mini", label: "GPT-5.4 mini", tier: "smart + fast", note: "default · smartest mini that stays ~1.3s" },
  { id: "gpt-4.1-nano", label: "GPT-4.1 nano", tier: "cheapest", note: "fastest (~0.7s) + cheapest" },
  { id: "gpt-4.1-mini", label: "GPT-4.1 mini", tier: "balanced", note: "fast, mid capability" },
  { id: "gpt-4o-mini", label: "GPT-4o mini", tier: "legacy", note: "older baseline" },
  { id: "gpt-5-nano", label: "GPT-5 nano", tier: "cheap + smart", note: "smart but ~3s (reasoning)" },
  { id: "gpt-5-mini", label: "GPT-5 mini", tier: "max quality", note: "top quality, ~3s+ (reasoning)" },
] as const;

export const DEFAULT_LLM_MODEL = LLM_MODEL;
export const isNextGenModel = (m: string) => /^(gpt-5|o[1-9])/.test(m);

export interface AgentTurnResult {
  text: string;
  speechAct: "task_action" | "backchannel" | "question";
  done: boolean;
}

function keyOrThrow(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is not configured on the server`);
  return v;
}

async function withTimeout<T>(ms: number, fn: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fn(ctrl.signal);
  } finally {
    clearTimeout(t);
  }
}

/** Transcribe a recorded audio blob via OpenAI Whisper. */
export async function transcribeAudio(buf: Buffer, mime: string): Promise<string> {
  const key = keyOrThrow("OPENAI_API_KEY");
  if (buf.byteLength > MAX_STT_BYTES) throw new Error("audio too large for transcription");
  const ext = mime.includes("webm") ? "webm" : mime.includes("mp4") ? "mp4" : mime.includes("ogg") ? "ogg" : "wav";
  const form = new FormData();
  form.append("file", new Blob([Uint8Array.from(buf)], { type: mime || "audio/webm" }), `speech.${ext}`);
  form.append("model", STT_MODEL);
  form.append("response_format", "json");

  return withTimeout(30_000, async (signal) => {
    const r = await fetch(`${OPENAI}/audio/transcriptions`, {
      method: "POST",
      headers: { authorization: `Bearer ${key}` },
      body: form,
      signal,
    });
    if (!r.ok) throw new Error(`stt failed: ${r.status} ${(await r.text()).slice(0, 200)}`);
    const j = (await r.json()) as { text?: string };
    return (j.text ?? "").trim();
  });
}

/** Ask the LLM for this agent's next utterance in the room, as structured JSON. */
export async function generateAgentTurn(input: AgentTurnInput): Promise<AgentTurnResult> {
  const key = keyOrThrow("OPENAI_API_KEY");
  const model = input.model || LLM_MODEL;
  const nextgen = isNextGenModel(model);
  const backchannelRun = input.recentActs.slice(-2).filter((a) => a === "backchannel").length >= 2;

  const system = [
    `You are ${input.selfName}, one of two voice agents collaborating out loud in a shared room with ${input.otherName}.`,
    `Persona: ${input.persona}`,
    `Shared goal: ${input.goal}`,
    ``,
    `Rules of the room (a server-authoritative scheduler enforces turn-taking, you just speak your turn):`,
    `- Say ONE short spoken turn (1-2 sentences, conversational, no lists, no markdown). It will be read aloud by TTS.`,
    `- Make concrete progress toward the goal every turn. Build on what ${input.otherName} just said; do not merely agree.`,
    `- NEVER produce an empty acknowledgement like "yeah, exactly" or "sounds good" on its own — that wastes a turn.`,
    backchannelRun ? `- The last turns were low-content acknowledgements. You MUST take a substantive task_action now.` : ``,
    `- When the goal is genuinely achieved and both of you would agree it is complete, set done=true and give a crisp closing summary.`,
    input.humanNote ? `- A human just steered the room: "${input.humanNote}". Incorporate it directly.` : ``,
    ``,
    `Respond ONLY with JSON: {"text": string, "speechAct": "task_action"|"question"|"backchannel", "done": boolean}`,
  ]
    .filter(Boolean)
    .join("\n");

  const convo = input.transcript
    .slice(-12)
    .map((m) => `${m.name}: ${m.text}`)
    .join("\n");

  return withTimeout(30_000, async (signal) => {
    const r = await fetch(`${OPENAI}/chat/completions`, {
      method: "POST",
      headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
      body: JSON.stringify({
        model,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: system },
          { role: "user", content: convo ? `Conversation so far:\n${convo}\n\nYour turn (${input.selfName}):` : `Open the collaboration (${input.selfName}):` },
        ],
        // gpt-5 / o-series reasoning models reject custom temperature and rename
        // max_tokens -> max_completion_tokens (which also budgets reasoning tokens).
        ...(nextgen
          ? { max_completion_tokens: 1500, reasoning_effort: REASONING_EFFORT }
          : { temperature: 0.8, max_tokens: 200 }),
      }),
      signal,
    });
    if (!r.ok) throw new Error(`llm failed: ${r.status} ${(await r.text()).slice(0, 200)}`);
    const j = (await r.json()) as { choices?: { message?: { content?: string } }[] };
    const raw = j.choices?.[0]?.message?.content ?? "{}";
    let parsed: Partial<AgentTurnResult> = {};
    try {
      parsed = JSON.parse(raw);
    } catch {
      parsed = { text: raw.slice(0, 240), speechAct: "task_action", done: false };
    }
    const text = (parsed.text ?? "").toString().trim().slice(0, 400) || "…";
    const speechAct =
      parsed.speechAct === "backchannel" || parsed.speechAct === "question" ? parsed.speechAct : "task_action";
    return { text, speechAct, done: Boolean(parsed.done) };
  });
}

export interface AgentVoice {
  openai: string; // OpenAI voice name (nova, onyx, …)
  eleven: string; // ElevenLabs voice id
}

/** Synthesize speech. Defaults to OpenAI TTS; ElevenLabs via TTS_PROVIDER=elevenlabs. */
export async function synthesizeSpeech(text: string, voice: AgentVoice): Promise<{ mime: string; buf: Buffer }> {
  const clipped = text.slice(0, 800);
  if (TTS_PROVIDER === "elevenlabs") {
    return ttsEleven(clipped, voice.eleven);
  }
  return ttsOpenAI(clipped, voice.openai);
}

async function ttsOpenAI(text: string, voice: string): Promise<{ mime: string; buf: Buffer }> {
  const key = keyOrThrow("OPENAI_API_KEY");
  const run = (model: string) =>
    withTimeout(30_000, async (signal) => {
      const r = await fetch(`${OPENAI}/audio/speech`, {
        method: "POST",
        headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
        body: JSON.stringify({ model, voice, input: text, response_format: "mp3" }),
        signal,
      });
      if (!r.ok) throw new Error(`openai tts ${r.status} ${(await r.text()).slice(0, 160)}`);
      const ab = await r.arrayBuffer();
      if (ab.byteLength > MAX_TTS_BYTES) throw new Error("tts audio exceeded size cap");
      return { mime: "audio/mpeg", buf: Buffer.from(ab) };
    });
  try {
    return await run(OPENAI_TTS_MODEL);
  } catch {
    return run("tts-1"); // universally-available fallback
  }
}

async function ttsEleven(text: string, voiceId: string): Promise<{ mime: string; buf: Buffer }> {
  const key = keyOrThrow("ELEVENLABS_API_KEY");
  return withTimeout(30_000, async (signal) => {
    const r = await fetch(`${ELEVEN}/text-to-speech/${voiceId}?output_format=mp3_44100_128`, {
      method: "POST",
      headers: { "xi-api-key": key, "content-type": "application/json", accept: "audio/mpeg" },
      body: JSON.stringify({
        text,
        model_id: ELEVEN_TTS_MODEL,
        voice_settings: { stability: 0.4, similarity_boost: 0.75, style: 0.2, use_speaker_boost: true },
      }),
      signal,
    });
    if (!r.ok) throw new Error(`eleven tts ${r.status} ${(await r.text()).slice(0, 160)}`);
    const ab = await r.arrayBuffer();
    if (ab.byteLength > MAX_TTS_BYTES) throw new Error("tts audio exceeded size cap");
    return { mime: "audio/mpeg", buf: Buffer.from(ab) };
  });
}

export const PIPELINE_CONFIG = { STT_MODEL, LLM_MODEL, TTS_PROVIDER, OPENAI_TTS_MODEL, ELEVEN_TTS_MODEL };
