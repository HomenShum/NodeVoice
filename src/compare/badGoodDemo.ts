import { validTurns } from "../core/agents.js";
import { createVoiceRoom } from "../core/roomReducer.js";
import { classifyUtterance } from "../core/speechActClassifier.js";
import { validCountTarget } from "../core/steering.js";
import { VOICE_AGENT_IDS, type ActorId, type RoomState, type SpeechAct } from "../core/types.js";
import { runVoiceStep } from "../voice/voiceAgent.js";
import { getOllamaModelName } from "../providers/localModels.js";
import { isOllamaAvailable } from "../providers/ollama.js";
import { getOpenAIModelName, hasOpenAIKey, openaiChat, type OpenAIChatMessage } from "../providers/openai.js";

export type ComparisonSource = "deterministic" | "ollama" | "openai";

type BadAgentIntent = "acknowledge" | "wait-for-someone" | "start-counting";

/**
 * What each bad-side agent privately believes. There is no shared room, so
 * this is the ONLY state each agent has — and it genuinely drives what the
 * agent says next (see utteranceForState / buildBadAgentPrompt). Three of
 * these never converge.
 */
export type BadAgentPrivateState = {
  agentId: ActorId;
  heardCount: number;
  spokeCount: number;
  believesCurrent: number;
  lastClassifiedAs: SpeechAct | "none";
  nextIntent: BadAgentIntent;
};

/** Honest disclosure of what produced the utterance text on each side. */
type ComparisonProvenance = {
  /**
   * What actually produced the GOOD side's text — the side that carries the
   * product's claim. `deterministic` here means no model text reached the room,
   * however the run was requested; it is decided AFTER the run, because a
   * provider that fails on turn 2 cannot be detected before turn 1.
   */
  mode: ComparisonSource;
  modelId: string | null;
  bad: string;
  good: string;
  /** Good-side turns whose text came from the deterministic fallback after a
   *  provider error. Non-zero means a model did not write those turns. */
  fallbackTurns: number;
};

type ComparisonStep = {
  turn: number;
  actorId: ActorId;
  text: string;
  speechAct: SpeechAct | "unknown";
  current?: number;
  next?: number;
  loopRisk: boolean;
  roomStateSummary: string;
  /** Bad side only: snapshot of all three private states after this turn. */
  agentStates?: BadAgentPrivateState[];
};

export type ComparisonResult = {
  bad: ComparisonStep[];
  good: ComparisonStep[];
  goodFinalState: RoomState;
  diagnosis: string[];
  selectedModel: string;
  provenance: ComparisonProvenance;
};

export async function runSideBySideComparison(options: {
  target?: number;
  turns?: number;
  useOllama?: boolean;
  model?: string;
  source?: ComparisonSource;
  openaiModel?: string;
} = {}): Promise<ComparisonResult> {
  // Every caller reaches the loops through here — the HTTP route, the CLI
  // (which reads Number(env) and can hand over NaN) and the tests — so the
  // counts are narrowed once, at this seam, and never again downstream.
  const target = validCountTarget(options.target, 12);
  const turns = validTurns(options.turns, 9);
  const ollamaModel = getOllamaModelName(options.model, "llama3_2_3b");
  const openaiModel = getOpenAIModelName(options.openaiModel);

  const requestedSource: ComparisonSource = options.source ?? (options.useOllama ? "ollama" : "deterministic");
  if (requestedSource === "openai" && !hasOpenAIKey()) {
    throw new Error("openai source requested but OPENAI_API_KEY is not set on the server (.env.local)");
  }
  // Provenance must reflect what actually generated text, not what was
  // requested: with no reachable Ollama the good side silently falls back to
  // the deterministic sim, so check availability once and report honestly.
  const source: ComparisonSource =
    requestedSource === "ollama" && !(await isOllamaAvailable()) ? "deterministic" : requestedSource;
  const selectedModel = source === "openai" ? openaiModel : ollamaModel;

  const bad =
    source === "openai"
      ? await runBadTranscriptLoopWithModel({ turns, target, model: openaiModel })
      : runBadTranscriptLoop(turns);
  const good = await runGoodRoomStateLoop({ target, turns, source, ollamaModel, openaiModel });

  // Only now is it knowable what wrote the good side's text: a provider can
  // fail on any turn, and the fallback that covers for it must not be reported
  // as a model result.
  const provenance = describeProvenance({
    source,
    requestedSource,
    openaiModel,
    ollamaModel,
    fallbackTurns: good.fallbackTurns,
    goodTurns: good.steps.length,
  });

  return {
    bad,
    good: good.steps,
    goodFinalState: good.state,
    selectedModel,
    provenance,
    diagnosis: [
      "Bad: every agent treats every heard utterance as a fresh invitation to respond socially.",
      "Bad: each agent has only a private belief (current=1) and an intent that oscillates between acknowledge and wait-for-someone — three private states, no shared truth.",
      "Bad: acknowledgement and handoff language becomes new conversational fuel, so no concrete task state advances.",
      "Good: the room reducer commits only task actions, suppresses acknowledgements, and schedules exactly one next speaker.",
      "Good: each agent receives the authoritative next action, not a raw transcript to politely react to.",
    ],
  };
}

const BAD_SCRIPTED_LABEL = "deterministic sim — scripted utterances · no reducer, no scheduler";

/**
 * Provenance is a claim about the past, so it is written after the run.
 * `fallbackTurns` is how many good-side turns the deterministic answer had to
 * cover for; when it covers all of them no model text reached the room, and
 * the mode says so. That is the same honesty the Ollama path already had,
 * extended to a provider that dies part-way instead of being absent up front.
 */
function describeProvenance(run: {
  source: ComparisonSource;
  requestedSource: ComparisonSource;
  openaiModel: string;
  ollamaModel: string;
  fallbackTurns: number;
  goodTurns: number;
}): ComparisonProvenance {
  const { source, fallbackTurns, goodTurns } = run;
  const modelId = source === "openai" ? run.openaiModel : source === "ollama" ? run.ollamaModel : null;
  const bad =
    source === "openai"
      ? `openai · ${run.openaiModel} · live · raw transcripts only, no reducer, no scheduler`
      : BAD_SCRIPTED_LABEL;

  if (source === "deterministic") {
    return {
      mode: "deterministic",
      modelId: null,
      bad,
      good:
        run.requestedSource === "ollama"
          ? "deterministic sim — Ollama unreachable, scripted utterances · real reducer & scheduler"
          : "deterministic sim — scripted utterances · real reducer & scheduler",
      fallbackTurns,
    };
  }

  const live = source === "openai" ? `openai · ${run.openaiModel} · live` : `real model — ${run.ollamaModel} via Ollama`;
  if (fallbackTurns === 0) {
    return { mode: source, modelId, bad, good: `${live} · real reducer & scheduler`, fallbackTurns };
  }
  if (fallbackTurns >= goodTurns && goodTurns > 0) {
    return {
      mode: "deterministic",
      modelId: null,
      bad,
      good: `deterministic fallback — ${modelId} produced no turn (${fallbackTurns}/${goodTurns} failed) · real reducer & scheduler`,
      fallbackTurns,
    };
  }
  return {
    mode: source,
    modelId,
    bad,
    good: `${live} · partial — ${fallbackTurns} of ${goodTurns} turns fell back to deterministic · real reducer & scheduler`,
    fallbackTurns,
  };
}

const BAD_START_TEXT = "I’ll count from 1 to 100, and you guys can continue off where I started from. One...";

const BAD_ACK_VARIANTS = [
  "Yeah exactly, let’s do that. I’ll start off from where you leave off...",
  "Yep exactly, let’s do that, we can continue from there...",
  "Yeah exactly, I agree with that plan and I’ll continue when it is my turn...",
  "Yep, exactly, let’s keep going from where the last agent leaves off...",
  "Sounds good, I’m aligned, and I’ll start after you finish...",
  "Exactly, we should count together and continue the sequence...",
];

/**
 * The utterance is a pure function of the speaker's private state — the
 * templated text is not display-only scripting; it is what an agent with this
 * belief/intent would say. That is what the LEFT state inspector visualizes.
 */
function utteranceForState(state: BadAgentPrivateState): { text: string; speechAct: SpeechAct } {
  if (state.nextIntent === "start-counting") {
    return { text: BAD_START_TEXT, speechAct: "instruction" };
  }
  if (state.nextIntent === "wait-for-someone") {
    // Scheduled to speak while still deferring: it says so out loud.
    return { text: "Sounds good, I’m aligned, and I’ll start after you finish...", speechAct: "backchannel" };
  }
  const index = (state.heardCount + state.spokeCount) % BAD_ACK_VARIANTS.length;
  return { text: BAD_ACK_VARIANTS[index] ?? BAD_ACK_VARIANTS[0]!, speechAct: "backchannel" };
}

/** After speaking, an agent politely yields and waits for someone else to count. */
function afterSpeaking(state: BadAgentPrivateState, speechAct: SpeechAct): BadAgentPrivateState {
  return {
    ...state,
    spokeCount: state.spokeCount + 1,
    believesCurrent: speechAct === "instruction" ? 1 : state.believesCurrent,
    nextIntent: "wait-for-someone",
  };
}

/**
 * Hearing any utterance triggers the politeness reflex: classify it, absorb
 * the only number ever spoken ("One..."), and flip intent back to acknowledge.
 * Without a shared reducer nothing ever commits 2, so believesCurrent stalls.
 */
function afterHearing(state: BadAgentPrivateState, heardAct: SpeechAct): BadAgentPrivateState {
  return {
    ...state,
    heardCount: state.heardCount + 1,
    lastClassifiedAs: heardAct,
    believesCurrent: heardAct === "instruction" ? Math.max(state.believesCurrent, 1) : state.believesCurrent,
    nextIntent: "acknowledge",
  };
}

function initialBadStates(): Map<ActorId, BadAgentPrivateState> {
  return new Map<ActorId, BadAgentPrivateState>(
    VOICE_AGENT_IDS.map((agentId, index): [ActorId, BadAgentPrivateState] => [
      agentId,
      {
        agentId,
        heardCount: 0,
        spokeCount: 0,
        believesCurrent: 0,
        lastClassifiedAs: "none",
        nextIntent: index === 0 ? "start-counting" : "wait-for-someone",
      },
    ]),
  );
}

function snapshotBadStates(states: Map<ActorId, BadAgentPrivateState>): BadAgentPrivateState[] {
  return VOICE_AGENT_IDS.map((agentId) => ({ ...states.get(agentId)! }));
}

function runBadTranscriptLoop(turns: number): ComparisonStep[] {
  const states = initialBadStates();

  const rows: ComparisonStep[] = [];
  for (let turn = 0; turn < turns; turn += 1) {
    const speakerId = VOICE_AGENT_IDS[turn % VOICE_AGENT_IDS.length]!;
    const speaker = states.get(speakerId)!;
    const { text, speechAct } = utteranceForState(speaker);

    states.set(speakerId, afterSpeaking(speaker, speechAct));
    for (const listenerId of VOICE_AGENT_IDS) {
      if (listenerId === speakerId) continue;
      states.set(listenerId, afterHearing(states.get(listenerId)!, speechAct));
    }

    const snapshot = snapshotBadStates(states);
    const beliefs = snapshot.map((s) => s.believesCurrent).join("/");
    rows.push({
      turn: turn + 1,
      actorId: speakerId,
      text,
      speechAct,
      current: 1,
      next: 2,
      loopRisk: turn >= 1,
      roomStateSummary:
        turn === 0
          ? "raw audio transcript only; no committed task counter"
          : `agreement loop; private beliefs current=${beliefs}; nobody ever commits 2`,
      agentStates: snapshot,
    });
  }
  return rows;
}

/**
 * openai mode: the bad-side agents generate real replies from private-state-
 * driven prompts. Each agent sees ONLY the raw peer transcript plus its own
 * private notes — no room state, no floor control, no scheduler. Whatever
 * comes back is classified truthfully (it is NOT forced to loop).
 */
export function buildBadAgentPrompt(
  state: BadAgentPrivateState,
  transcript: { actorId: string; text: string }[],
  target: number,
): OpenAIChatMessage[] {
  const system = [
    `You are ${state.agentId}, one of three iPhone voice assistants (voice-a, voice-b, voice-c) standing together in a live group voice conversation.`,
    "Architecture constraint: you receive ONLY the raw audio transcript of what has been said. There is no shared task state, no floor control, and no turn scheduler.",
    "Reply with exactly one short spoken utterance — the single thing you would actually say next out loud. No stage directions, no markdown.",
  ].join("\n");

  const transcriptLines =
    transcript.length > 0
      ? transcript.map((entry) => `${entry.actorId}: ${entry.text}`).join("\n")
      : "(nobody has spoken yet)";
  const beliefNote =
    state.believesCurrent > 0
      ? `you believe the count is currently at ${state.believesCurrent}`
      : "you have not heard any number committed yet";
  const user = [
    `The user asked the three of you: "Count from 1 to ${target} together."`,
    "",
    "Raw transcript so far:",
    transcriptLines,
    "",
    `Your private notes (only you can see these): you have spoken ${state.spokeCount} time(s), heard ${state.heardCount} utterance(s), and ${beliefNote}.`,
    "What do you say next?",
  ].join("\n");

  return [
    { role: "system", content: system },
    { role: "user", content: user },
  ];
}

async function runBadTranscriptLoopWithModel(options: {
  turns: number;
  target: number;
  model: string;
}): Promise<ComparisonStep[]> {
  const states = initialBadStates();
  // Classification context only (our truthful labeler) — never shown to agents.
  const classifierRoom = createVoiceRoom(options.target);
  const transcript: { actorId: ActorId; text: string }[] = [];

  const rows: ComparisonStep[] = [];
  for (let turn = 0; turn < options.turns; turn += 1) {
    const speakerId = VOICE_AGENT_IDS[turn % VOICE_AGENT_IDS.length]!;
    const speaker = states.get(speakerId)!;
    const text = await openaiChat(buildBadAgentPrompt(speaker, transcript, options.target), { model: options.model });
    const classified = classifyUtterance(
      { id: `bad_live_${turn + 1}`, actorId: speakerId, text, ts: Date.now() },
      classifierRoom,
    );

    states.set(speakerId, {
      ...speaker,
      spokeCount: speaker.spokeCount + 1,
      believesCurrent: classified.extractedNumber ?? speaker.believesCurrent,
      nextIntent: "wait-for-someone",
    });
    for (const listenerId of VOICE_AGENT_IDS) {
      if (listenerId === speakerId) continue;
      const listener = states.get(listenerId)!;
      states.set(listenerId, {
        ...listener,
        heardCount: listener.heardCount + 1,
        lastClassifiedAs: classified.speechAct,
        believesCurrent: classified.extractedNumber ?? listener.believesCurrent,
        nextIntent:
          classified.extractedNumber !== undefined || classified.speechAct === "task_action"
            ? "start-counting"
            : "acknowledge",
      });
    }
    transcript.push({ actorId: speakerId, text });

    const snapshot = snapshotBadStates(states);
    const beliefs = snapshot.map((s) => s.believesCurrent).join("/");
    const maxBelief = Math.max(...snapshot.map((s) => s.believesCurrent));
    rows.push({
      turn: turn + 1,
      actorId: speakerId,
      text,
      speechAct: classified.speechAct,
      current: maxBelief,
      next: maxBelief + 1,
      loopRisk: turn >= 1 && classified.speechAct === "backchannel",
      roomStateSummary: `no shared room; private beliefs current=${beliefs}; classified=${classified.speechAct}`,
      agentStates: snapshot,
    });
  }
  return rows;
}

async function runGoodRoomStateLoop(options: {
  target: number;
  turns: number;
  source: ComparisonSource;
  ollamaModel: string;
  openaiModel: string;
}): Promise<{ state: RoomState; steps: ComparisonStep[]; fallbackTurns: number }> {
  let state = createVoiceRoom(options.target);
  const steps: ComparisonStep[] = [];
  let fallbackTurns = 0;

  for (let i = 0; i < options.turns && state.task.kind === "count_to_n" && !state.task.completed; i += 1) {
    const actorId = state.nextSpeaker ?? VOICE_AGENT_IDS[0]!;
    state = await runVoiceStep(state, {
      actorId,
      label: actorId,
      source: options.source,
      useOllama: options.source === "ollama",
      model: options.ollamaModel,
      openaiModel: options.openaiModel,
      onProviderError: () => {
        fallbackTurns += 1;
      },
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

  return { state, steps, fallbackTurns };
}
