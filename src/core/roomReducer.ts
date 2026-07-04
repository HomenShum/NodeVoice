import { classifyUtterance } from "./speechActClassifier.js";
import type { ActorId, Artifact, ClassifiedUtterance, RoomState, RoomTask, Utterance } from "./types.js";
import { NODE_AGENT_IDS, VOICE_AGENT_IDS } from "./types.js";

export function createVoiceRoom(target = 100): RoomState {
  return {
    roomId: "voice-demo-room",
    mode: "execution",
    floorOwner: "voice-a",
    nextSpeaker: "voice-a",
    suppressAcknowledgements: true,
    loopRisk: false,
    requiredNextAct: "task_action",
    turnQueue: [...VOICE_AGENT_IDS],
    task: { kind: "count_to_n", target, current: 0, next: 1, completed: false },
    utterances: [],
    artifacts: [],
    version: 0,
  };
}

export function createNodeAgentRoom(goal: string): RoomState {
  return {
    roomId: "nodeagent-local-room",
    mode: "execution",
    floorOwner: "context-agent",
    nextSpeaker: "context-agent",
    suppressAcknowledgements: true,
    loopRisk: false,
    requiredNextAct: "artifact_patch",
    turnQueue: [...NODE_AGENT_IDS],
    task: {
      kind: "nodeagent_loop",
      goal,
      phase: "collect_context",
      contextIds: [],
      sourceIds: [],
      modelVersion: 1,
      completed: false,
    },
    utterances: [],
    artifacts: [],
    version: 0,
  };
}

export function applyUtterance(state: RoomState, utterance: Utterance): RoomState {
  const classified = classifyUtterance(utterance, state);
  const next: RoomState = {
    ...state,
    utterances: [...state.utterances, classified],
    version: state.version + 1,
  };

  const taskUpdated = applyTaskMutation(next, classified);
  const guarded = applyLoopGuard(taskUpdated);
  const scheduled = scheduleNextSpeaker(guarded, classified.actorId);
  return scheduled;
}

export function addArtifact(state: RoomState, artifact: Artifact): RoomState {
  const next: RoomState = {
    ...state,
    artifacts: [...state.artifacts, artifact],
    version: state.version + 1,
  };
  if (next.task.kind !== "nodeagent_loop") return next;

  const task = next.task;
  let newTask: RoomTask = task;
  if (artifact.kind === "context_bundle") {
    const payload = artifact.payload as { contextIds?: string[] };
    newTask = { ...task, phase: "synthesize", contextIds: payload.contextIds ?? [] };
  } else if (artifact.kind === "grounded_answer") {
    const payload = artifact.payload as { sourceIds?: string[] };
    newTask = { ...task, phase: "apply_model_delta", sourceIds: payload.sourceIds ?? [] };
  } else if (artifact.kind === "spreadsheet_delta") {
    const payload = artifact.payload as { nextVersion?: number };
    newTask = { ...task, phase: "write_memo", modelVersion: payload.nextVersion ?? task.modelVersion + 1 };
  } else if (artifact.kind === "notebook_memo") {
    newTask = { ...task, phase: "done", completed: true };
  }

  return scheduleNextSpeaker({ ...next, task: newTask }, artifact.createdBy);
}

function applyTaskMutation(state: RoomState, utterance: ClassifiedUtterance): RoomState {
  if (state.task.kind === "count_to_n") {
    if (utterance.speechAct !== "task_action" || utterance.extractedNumber === undefined) return state;
    const expected = state.task.next;
    if (utterance.extractedNumber !== expected) {
      return {
        ...state,
        loopRisk: true,
        requiredNextAct: "correction",
      };
    }
    const current = utterance.extractedNumber;
    const completed = current >= state.task.target;
    return {
      ...state,
      task: {
        ...state.task,
        current,
        next: completed ? current : current + 1,
        completed,
      },
      requiredNextAct: completed ? null : "task_action",
      mode: completed ? "review" : "execution",
    };
  }

  return state;
}

function applyLoopGuard(state: RoomState): RoomState {
  const lastActs = state.utterances.slice(-3).map((u) => u.speechAct);
  const backchannelRun = lastActs.filter((act) => act === "backchannel").length >= 2;
  if (!backchannelRun) {
    return {
      ...state,
      loopRisk: false,
      suppressAcknowledgements: true,
      requiredNextAct: state.task.completed ? null : state.requiredNextAct,
    };
  }
  return {
    ...state,
    loopRisk: true,
    suppressAcknowledgements: true,
    requiredNextAct: state.task.kind === "nodeagent_loop" ? "artifact_patch" : "task_action",
  };
}

function scheduleNextSpeaker(state: RoomState, lastActor: ActorId): RoomState {
  if (state.task.completed) return { ...state, floorOwner: null, nextSpeaker: null };
  const queue = state.turnQueue;
  const lastIndex = queue.indexOf(lastActor);
  const nextIndex = lastIndex === -1 ? 0 : (lastIndex + 1) % queue.length;
  const nextSpeaker = queue[nextIndex] ?? queue[0] ?? null;
  return {
    ...state,
    floorOwner: nextSpeaker,
    nextSpeaker,
  };
}
