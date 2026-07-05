import { isNextGenModel } from "../live/pipeline.js";

export type OpenAIChatMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

export type OpenAIChatOptions = {
  model?: string;
  timeoutMs?: number;
};

/** Repo-measured coordinator default (see src/live/pipeline.ts model notes). */
export const FALLBACK_OPENAI_MODEL = "gpt-5.4-mini";

export function getOpenAIModelName(override?: string): string {
  const trimmedOverride = override?.trim();
  if (trimmedOverride) return trimmedOverride;
  const envModel = process.env.OPENAI_MODEL?.trim();
  return envModel || FALLBACK_OPENAI_MODEL;
}

/** Server-side only: the key is read from process.env and never leaves the server. */
export function hasOpenAIKey(): boolean {
  return Boolean(process.env.OPENAI_API_KEY);
}

export async function openaiChat(messages: OpenAIChatMessage[], options: OpenAIChatOptions = {}): Promise<string> {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error("OPENAI_API_KEY is not configured on the server");
  const model = getOpenAIModelName(options.model);
  const timeoutMs = options.timeoutMs ?? 30_000;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
      body: JSON.stringify({
        model,
        messages,
        // gpt-5 / o-series reasoning models reject custom temperature and rename
        // max_tokens -> max_completion_tokens (same shape as src/live/pipeline.ts).
        ...(isNextGenModel(model)
          ? { max_completion_tokens: 600, reasoning_effort: process.env.REASONING_EFFORT ?? "low" }
          : { temperature: 0.8, max_tokens: 120 }),
      }),
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error(`OpenAI HTTP ${response.status}: ${(await response.text()).slice(0, 200)}`);
    }
    const payload = (await response.json()) as { choices?: { message?: { content?: string } }[] };
    return payload.choices?.[0]?.message?.content?.trim() ?? "";
  } finally {
    clearTimeout(timeout);
  }
}
