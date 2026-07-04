import { createVoiceRoom } from "../core/roomReducer.js";
import { VOICE_AGENT_IDS, type ActorId, type RoomState, type SpeechAct } from "../core/types.js";
import { runVoiceStep } from "../voice/voiceAgent.js";
import { getOllamaModelName } from "../providers/localModels.js";

export type ComparisonStep = {
  turn: number;
  actorId: ActorId;
  text: string;
  speechAct: SpeechAct | "unknown";
  current?: number;
  next?: number;
  loopRisk: boolean;
  roomStateSummary: string;
};

export type ComparisonResult = {
  bad: ComparisonStep[];
  good: ComparisonStep[];
  goodFinalState: RoomState;
  diagnosis: string[];
  selectedModel: string;
};

export async function runSideBySideComparison(options: {
  target?: number;
  turns?: number;
  useOllama?: boolean;
  model?: string;
} = {}): Promise<ComparisonResult> {
  const target = options.target ?? 12;
  const turns = options.turns ?? 9;
  const selectedModel = getOllamaModelName(options.model, "llama3_2_3b");

  const bad = runBadTranscriptLoop(turns);
  const good = await runGoodRoomStateLoop({ target, turns, useOllama: options.useOllama ?? false, model: selectedModel });

  return {
    bad,
    good: good.steps,
    goodFinalState: good.state,
    selectedModel,
    diagnosis: [
      "Bad: every agent treats every heard utterance as a fresh invitation to respond socially.",
      "Bad: acknowledgement and handoff language becomes new conversational fuel, so no concrete task state advances.",
      "Good: the room reducer commits only task actions, suppresses acknowledgements, and schedules exactly one next speaker.",
      "Good: each agent receives the authoritative next action, not a raw transcript to politely react to.",
    ],
  };
}

function runBadTranscriptLoop(turns: number): ComparisonStep[] {
  const scripted = [
    {
      actorId: "voice-a" as ActorId,
      text: "I’ll count from 1 to 100, and you guys can continue off where I started from. One...",
      speechAct: "instruction" as const,
      roomStateSummary: "raw audio transcript only; no committed task counter",
    },
    {
      actorId: "voice-b" as ActorId,
      text: "Yeah exactly, let’s do that. I’ll start off from where you leave off...",
      speechAct: "backchannel" as const,
      roomStateSummary: "agent heard A, politely acknowledged, did not commit number 2",
    },
    {
      actorId: "voice-c" as ActorId,
      text: "Yep exactly, let’s do that, we can continue from there...",
      speechAct: "backchannel" as const,
      roomStateSummary: "agent heard B, echoed the plan, did not commit number 3",
    },
  ];

  const rows: ComparisonStep[] = [];
  for (let turn = 0; turn < turns; turn += 1) {
    const template = scripted[turn % scripted.length]!;
    const loopedText = turn < scripted.length ? template.text : acknowledgementVariant(turn, template.actorId);
    rows.push({
      turn: turn + 1,
      actorId: template.actorId,
      text: loopedText,
      speechAct: template.speechAct,
      current: turn === 0 ? 1 : 1,
      next: 2,
      loopRisk: turn >= 1,
      roomStateSummary: turn === 0 ? template.roomStateSummary : "agreement loop; task stuck at current=1, next=2",
    });
  }
  return rows;
}

function acknowledgementVariant(turn: number, actorId: ActorId): string {
  const variants = [
    "Yeah exactly, I agree with that plan and I’ll continue when it is my turn...",
    "Yep, exactly, let’s keep going from where the last agent leaves off...",
    "Sounds good, I’m aligned, and I’ll start after you finish...",
    "Exactly, we should count together and continue the sequence...",
  ];
  return `${variants[turn % variants.length]} (${actorId})`;
}

async function runGoodRoomStateLoop(options: {
  target: number;
  turns: number;
  useOllama: boolean;
  model: string;
}): Promise<{ state: RoomState; steps: ComparisonStep[] }> {
  let state = createVoiceRoom(options.target);
  const steps: ComparisonStep[] = [];

  for (let i = 0; i < options.turns && state.task.kind === "count_to_n" && !state.task.completed; i += 1) {
    const actorId = state.nextSpeaker ?? VOICE_AGENT_IDS[0]!;
    state = await runVoiceStep(state, {
      actorId,
      label: actorId,
      useOllama: options.useOllama,
      model: options.model,
    });
    const last = state.utterances.at(-1)!;
    steps.push({
      turn: i + 1,
      actorId: last.actorId,
      text: last.text,
      speechAct: last.speechAct,
      current: state.task.kind === "count_to_n" ? state.task.current : undefined,
      next: state.task.kind === "count_to_n" ? state.task.next : undefined,
      loopRisk: state.loopRisk,
      roomStateSummary: state.task.kind === "count_to_n"
        ? `committed current=${state.task.current}; next=${state.task.next}; scheduled=${state.nextSpeaker ?? "none"}`
        : "not a voice count task",
    });
  }

  return { state, steps };
}
