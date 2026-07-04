export type ActorId = "user" | "voice-a" | "voice-b" | "voice-c" | "context-agent" | "synthesis-agent" | "model-agent" | "memo-agent";

export type RoomMode = "discussion" | "execution" | "handoff" | "review";

export type SpeechAct =
  | "backchannel"
  | "task_action"
  | "handoff"
  | "claim_floor"
  | "clarification"
  | "correction"
  | "summary"
  | "instruction"
  | "artifact_patch";

export type RoomTask =
  | {
      kind: "count_to_n";
      target: number;
      current: number;
      next: number;
      completed: boolean;
    }
  | {
      kind: "nodeagent_loop";
      goal: string;
      phase: "collect_context" | "synthesize" | "apply_model_delta" | "write_memo" | "done";
      contextIds: string[];
      sourceIds: string[];
      modelVersion: number;
      completed: boolean;
    };

export type Utterance = {
  id: string;
  actorId: ActorId;
  text: string;
  ts: number;
};

export type ClassifiedUtterance = Utterance & {
  speechAct: SpeechAct;
  extractedNumber?: number;
  confidence: number;
  reason: string;
};

export type Artifact = {
  id: string;
  kind: "context_bundle" | "grounded_answer" | "spreadsheet_delta" | "notebook_memo" | "voice_transcript";
  title: string;
  payload: unknown;
  createdBy: ActorId;
  createdAt: number;
};

export type RoomState = {
  roomId: string;
  mode: RoomMode;
  floorOwner: ActorId | null;
  nextSpeaker: ActorId | null;
  suppressAcknowledgements: boolean;
  loopRisk: boolean;
  requiredNextAct: SpeechAct | null;
  turnQueue: ActorId[];
  task: RoomTask;
  utterances: ClassifiedUtterance[];
  artifacts: Artifact[];
  version: number;
};

export type AgentDecision = {
  actorId: ActorId;
  text: string;
  intendedSpeechAct: SpeechAct;
  blocked?: boolean;
  blockReason?: string;
};

export const VOICE_AGENT_IDS: ActorId[] = ["voice-a", "voice-b", "voice-c"];
export const NODE_AGENT_IDS: ActorId[] = ["context-agent", "synthesis-agent", "model-agent", "memo-agent"];
