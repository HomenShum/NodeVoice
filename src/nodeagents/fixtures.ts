export type DemoDoc = {
  id: string;
  title: string;
  text: string;
  citations: string[];
};

export type DemoModel = {
  version: number;
  cells: Record<string, number | string>;
  formulas: Record<string, string>;
  auditLog: Array<{ version: number; actorId: string; op: string; cell: string; before: unknown; after: unknown }>;
};

export const demoDocs: DemoDoc[] = [
  {
    id: "room-msg-1",
    title: "Live room instruction",
    text: "The team wants a local-first multi-agent room where agents continue work instead of acknowledging each other. The first demo should prove counting, then prove NodeAgent artifact patches.",
    citations: ["room:instruction:1"],
  },
  {
    id: "arch-1",
    title: "Room OS architecture",
    text: "Every utterance is classified as a speech act. Backchannels do not trigger responses. Task actions mutate shared state. Handoffs update the floor owner. The server is authoritative for task state and artifact commits.",
    citations: ["design:room-os:1"],
  },
  {
    id: "model-1",
    title: "Spreadsheet delta rule",
    text: "Spreadsheet updates must be optimistic-concurrency deltas. A delta carries previousVersion and nextVersion and fails instead of clobbering newer state.",
    citations: ["design:model-delta:1"],
  },
  {
    id: "memo-1",
    title: "Memo contract",
    text: "The final memo should cite the room-state evidence, explain what was changed, and include the model version receipt.",
    citations: ["design:memo:1"],
  },
];

export const demoModel: DemoModel = {
  version: 1,
  cells: {
    A1: "Metric",
    B1: "Value",
    A2: "Loop risk incidents",
    B2: 3,
    A3: "Committed task actions",
    B3: 0,
  },
  formulas: {},
  auditLog: [],
};
