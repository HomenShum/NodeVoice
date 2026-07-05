import { nextId } from "../core/ids.js";
import { numberToWords } from "../core/numberWords.js";
import { applyUtterance } from "../core/roomReducer.js";
import type { ActorId, AgentDecision, RoomState, Utterance } from "../core/types.js";
import { enforceRoomPolicy } from "../core/guards.js";
import { isOllamaAvailable, ollamaChat } from "../providers/ollama.js";
import { openaiChat } from "../providers/openai.js";

export type VoiceAgentConfig = {
  actorId: ActorId;
  label: string;
  useOllama?: boolean;
  model?: string;
  source?: "deterministic" | "ollama" | "openai";
  openaiModel?: string;
};

export async function decideVoiceUtterance(state: RoomState, config: VoiceAgentConfig): Promise<AgentDecision> {
  if (state.task.kind !== "count_to_n") {
    throw new Error("voice MVP currently expects a count_to_n task");
  }

  const requiredNumber = state.task.next;
  const deterministic: AgentDecision = {
    actorId: config.actorId,
    text: numberToWords(requiredNumber),
    intendedSpeechAct: "task_action",
  };

  const source = config.source ?? (config.useOllama ? "ollama" : "deterministic");
  if (source === "deterministic") return deterministic;
  if (source === "ollama" && !(await isOllamaAvailable())) return deterministic;

  const prompt = [
    "You are inside a multi-agent realtime voice room.",
    "The room state, not the transcript, is authoritative.",
    `Task: count from 1 to ${state.task.target}.`,
    `Last committed number: ${state.task.current}.`,
    `Required next speech act: ${state.requiredNextAct ?? "task_action"}.`,
    `You must say only the next number: ${requiredNumber}.`,
    "No acknowledgement. No explanation. No 'yeah exactly'.",
  ].join("\n");
  const messages = [
    { role: "system" as const, content: "Return only the requested spoken utterance, with no markdown." },
    { role: "user" as const, content: prompt },
  ];

  try {
    const text =
      source === "openai"
        ? await openaiChat(messages, { model: config.openaiModel })
        : await ollamaChat(messages, { model: config.model });
    const cleaned = sanitizeNumberOnly(text, requiredNumber);
    return { actorId: config.actorId, text: cleaned, intendedSpeechAct: "task_action" };
  } catch {
    return deterministic;
  }
}

export async function runVoiceStep(state: RoomState, config: VoiceAgentConfig): Promise<RoomState> {
  const rawDecision = await decideVoiceUtterance(state, config);
  const decision = enforceRoomPolicy(state, rawDecision);
  const text = decision.blocked && state.task.kind === "count_to_n" ? numberToWords(state.task.next) : decision.text;
  const utterance: Utterance = {
    id: nextId("utt"),
    actorId: config.actorId,
    text,
    ts: Date.now(),
  };
  return applyUtterance(state, utterance);
}

function sanitizeNumberOnly(text: string, requiredNumber: number): string {
  const trimmed = text.replace(/["'`]/g, "").trim();
  if (/^\d{1,3}$/.test(trimmed)) return trimmed;
  if (trimmed.split(/\s+/).length <= 3 && !/yeah|yep|exactly|agree|continue/i.test(trimmed)) return trimmed;
  return numberToWords(requiredNumber);
}
