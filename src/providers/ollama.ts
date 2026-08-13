/**
 * Talking to a model running on the same machine (Ollama), so the demo works
 * with no account and no API key. Every call is time-boxed: if the local model
 * is slow or absent the caller falls back to the scripted script rather than
 * hanging.
 */

export type OllamaChatMessage = {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
};

export type OllamaOptions = {
  model?: string;
  host?: string;
  timeoutMs?: number;
};

export async function ollamaChat(messages: OllamaChatMessage[], options: OllamaOptions = {}): Promise<string> {
  const host = options.host ?? process.env.OLLAMA_HOST ?? "http://localhost:11434";
  const model = options.model ?? process.env.OLLAMA_MODEL ?? "llama3.2:3b";
  const timeoutMs = options.timeoutMs ?? 20_000;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(`${host}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model, stream: false, messages }),
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error(`Ollama HTTP ${response.status}: ${await response.text()}`);
    }
    const payload = (await response.json()) as { message?: { content?: string } };
    return payload.message?.content?.trim() ?? "";
  } finally {
    clearTimeout(timeout);
  }
}

/** Is a local model actually running? Answers within 800 ms either way. */
export async function isOllamaAvailable(): Promise<boolean> {
  const host = process.env.OLLAMA_HOST ?? "http://localhost:11434";
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 800);
    const response = await fetch(`${host}/api/tags`, { signal: controller.signal });
    clearTimeout(timeout);
    return response.ok;
  } catch {
    return false;
  }
}
