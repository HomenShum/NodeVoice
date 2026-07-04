import { nextId } from "../core/ids.js";
import { addArtifact, applyUtterance, createNodeAgentRoom } from "../core/roomReducer.js";
import type { Artifact, RoomState, Utterance } from "../core/types.js";
import { isOllamaAvailable, ollamaChat } from "../providers/ollama.js";
import { demoDocs, demoModel, type DemoDoc, type DemoModel } from "./fixtures.js";

export type NodeAgentRunResult = {
  state: RoomState;
  artifacts: Artifact[];
  model: DemoModel;
};

export async function runLocalNodeAgentLoop(
  goal: string,
  useOllama = process.env.USE_OLLAMA === "1",
  llmModel?: string,
): Promise<NodeAgentRunResult> {
  let state = createNodeAgentRoom(goal);
  let model: DemoModel = structuredClone(demoModel);

  const contextArtifact = collectContext(goal, demoDocs);
  state = commitAgentArtifact(state, contextArtifact);

  const answerArtifact = await synthesizeAnswer(goal, contextArtifact, useOllama, llmModel);
  state = commitAgentArtifact(state, answerArtifact);

  const deltaArtifact = applyModelDelta(model, answerArtifact);
  model = (deltaArtifact.payload as { model: DemoModel }).model;
  state = commitAgentArtifact(state, deltaArtifact);

  const memoArtifact = await writeMemo(goal, state, model, useOllama, llmModel);
  state = commitAgentArtifact(state, memoArtifact);

  return { state, artifacts: state.artifacts, model };
}

function collectContext(goal: string, docs: DemoDoc[]): Artifact {
  const terms = goal.toLowerCase().split(/\W+/).filter((term) => term.length >= 4);
  const scored = docs
    .map((doc) => {
      const haystack = `${doc.title} ${doc.text}`.toLowerCase();
      const score = terms.reduce((sum, term) => sum + (haystack.includes(term) ? 1 : 0), 0);
      return { doc, score };
    })
    .sort((a, b) => b.score - a.score || a.doc.id.localeCompare(b.doc.id))
    .slice(0, 3);

  return {
    id: nextId("artifact"),
    kind: "context_bundle",
    title: "Ranked local context bundle",
    createdBy: "context-agent",
    createdAt: Date.now(),
    payload: {
      contextIds: scored.map((item) => item.doc.id),
      contexts: scored.map((item) => ({ ...item.doc, score: item.score })),
    },
  };
}

async function synthesizeAnswer(goal: string, contextArtifact: Artifact, useOllama: boolean, model?: string): Promise<Artifact> {
  const contexts = ((contextArtifact.payload as { contexts: Array<DemoDoc & { score: number }> }).contexts ?? []);
  const sourceIds = contexts.flatMap((doc) => doc.citations);
  const evidence = contexts.map((doc) => `- ${doc.title}: ${doc.text} [${doc.citations.join(", ")}]`).join("\n");
  let answer = `The MVP should use a server-authoritative room state. Backchannels are classified but do not schedule responses; task actions commit deltas; NodeAgent steps emit artifacts instead of conversational acknowledgements. Sources: ${sourceIds.join(", ")}.`;

  if (useOllama && (await isOllamaAvailable())) {
    try {
      answer = await ollamaChat([
        { role: "system", content: "Produce a concise grounded answer using only the provided evidence. Preserve citation IDs in brackets." },
        { role: "user", content: `Goal: ${goal}\n\nEvidence:\n${evidence}` },
      ],
      { model },
    );
    } catch {
      // Keep deterministic fallback.
    }
  }

  return {
    id: nextId("artifact"),
    kind: "grounded_answer",
    title: "Grounded local synthesis",
    createdBy: "synthesis-agent",
    createdAt: Date.now(),
    payload: { answer, sourceIds, evidenceCount: contexts.length },
  };
}

function applyModelDelta(model: DemoModel, answerArtifact: Artifact): Artifact {
  const previousVersion = model.version;
  const sourceIds = (answerArtifact.payload as { sourceIds: string[] }).sourceIds;
  const before = model.cells.B3;
  const after = sourceIds.length;
  const next: DemoModel = {
    ...model,
    version: previousVersion + 1,
    cells: { ...model.cells, B3: after },
    auditLog: [
      ...model.auditLog,
      { version: previousVersion + 1, actorId: "model-agent", op: "set", cell: "B3", before, after },
    ],
  };

  return {
    id: nextId("artifact"),
    kind: "spreadsheet_delta",
    title: "Versioned model delta",
    createdBy: "model-agent",
    createdAt: Date.now(),
    payload: {
      previousVersion,
      nextVersion: next.version,
      delta: { op: "set", cell: "B3", value: after, reason: "Count source-backed citations in synthesis artifact." },
      model: next,
    },
  };
}

async function writeMemo(goal: string, state: RoomState, model: DemoModel, useOllama: boolean, llmModel?: string): Promise<Artifact> {
  const answer = state.artifacts.find((artifact) => artifact.kind === "grounded_answer")?.payload as { answer?: string; sourceIds?: string[] } | undefined;
  const delta = state.artifacts.find((artifact) => artifact.kind === "spreadsheet_delta")?.payload as { previousVersion?: number; nextVersion?: number } | undefined;
  const sourceIds = answer?.sourceIds ?? [];
  let memo = [
    `Goal: ${goal}`,
    `Decision: Use a shared room-state reducer between voice agents and NodeAgent frames.`,
    `Evidence: ${sourceIds.join(", ")}.`,
    `Model receipt: version ${delta?.previousVersion ?? "?"} -> ${delta?.nextVersion ?? model.version}.`,
    `Operational rule: suppress acknowledgements when the next required act is a task action or artifact patch.`,
  ].join("\n");

  if (useOllama && (await isOllamaAvailable())) {
    try {
      memo = await ollamaChat([
        { role: "system", content: "Write a compact engineering memo. Use only the provided facts. Keep citation IDs." },
        { role: "user", content: memo },
      ],
      { model: llmModel },
    );
    } catch {
      // Keep deterministic fallback.
    }
  }

  return {
    id: nextId("artifact"),
    kind: "notebook_memo",
    title: "Cited notebook memo",
    createdBy: "memo-agent",
    createdAt: Date.now(),
    payload: {
      blocks: [
        { type: "claim", text: "Local agents should collaborate through room state, not raw peer transcript." },
        { type: "citation", sourceIds },
        { type: "memo", text: memo },
      ],
      markdown: memo,
    },
  };
}

function commitAgentArtifact(state: RoomState, artifact: Artifact): RoomState {
  const utterance: Utterance = {
    id: nextId("utt"),
    actorId: artifact.createdBy,
    text: `ARTIFACT_PATCH:${artifact.kind}:${artifact.id}`,
    ts: Date.now(),
  };
  return addArtifact(applyUtterance(state, utterance), artifact);
}
