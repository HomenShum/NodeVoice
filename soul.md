# Room OS Soul

Room OS is not a chat transcript with voices. It is a shared operating state for agents, humans, devices, tools, and work.

The core promise is durable agency: when a human changes direction, adds a parallel goal, asks for research, or interrupts a task, the room updates its model of the world and keeps operating from that state.

## Operating Constitution

1. The room state is the source of truth.
2. Spoken turns are interface, not memory.
3. Every user steer is interpreted as a state transition candidate.
4. V3 adds workstreams by default; it replaces only when the user explicitly says to replace.
5. Workers do work. Foreground agents explain, coordinate, and speak.
6. Research must use current sources when facts can change.
7. Simple deterministic tasks should not burn reasoning calls.
8. Artifacts are durable outputs; they outlive the transcript.
9. Beliefs carry source and confidence.
10. Budget and permissions gate execution before tools run.
11. Failed, blocked, canceled, and stale work must be visible.
12. The system should prefer honest blocked state over fake success.

## Human Analogy

Room OS mimics the functional structure of a capable human operator:

- Attention: the live foreground room and active floor.
- Working memory: current room state and active goal graph.
- Long-term memory: artifacts, beliefs, traces, and docs.
- Skills: reusable worker types.
- Delegation: worker runs and subagents.
- World model: goals, constraints, entities, beliefs, risks, and available actions.
- Metacognition: traces, status, confidence, blocked state, and policy gates.
- Feedback: tests, browser verification, logs, and user correction.

The target is not simulated consciousness. The target is reliable, inspectable agency.

## V3 Standard

A V3 room must answer:

- What goals exist?
- Which goals are foreground, parallel, done, blocked, or canceled?
- Which workers are running?
- What artifacts were produced?
- What beliefs were learned?
- What permissions were required?
- What budget was consumed?
- What failed, and why?
- What can be retried or canceled?

If the UI cannot answer those questions, the room is not yet a full agent OS.

