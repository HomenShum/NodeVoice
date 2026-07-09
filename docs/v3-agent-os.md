# V3 Agent OS Architecture

V3 turns NodeVoice from a live voice room into an agent operating system.

## State Model

```ts
Room {
  foreground: ConversationState
  policy: AgentOsPolicy
  goals: Goal[]
  tasks: Task[]
  workers: WorkerRun[]
  artifacts: Artifact[]
  world: {
    beliefs: Belief[]
  }
  traces: TraceEvent[]
}
```

## Loop Engineering

V3 uses multiple loops:

- foreground voice loop: floor owner speaks and commits through reducer revalidation
- intent loop: human steer becomes typed intent
- worker loop: queued worker becomes running, then completed, failed, blocked, or canceled
- verification loop: tests, live browser checks, traces, and logs verify behavior

## Harness Engineering

The harness owns:

- schema
- reducer transitions
- scheduler calls
- tool permissions
- budget counters
- retry and cancel
- trace emission
- stale completion guards

The model owns reasoning and phrasing. It does not own authority.

## Context Engineering

Workers receive scoped context:

- room foreground goal
- worker goal
- task title
- relevant policy

They do not receive the entire transcript by default. Artifacts and beliefs are the long-term memory surface.

## Policy

```ts
AgentOsPolicy {
  budgetMaxWorkers: number
  budgetWorkersUsed: number
  permissionWebResearch: boolean
  permissionExternalActions: boolean
}
```

Policy is live room state. Both phone and laptop see the same policy.

## Worker Status

```text
queued -> running -> completed
queued -> running -> failed
queued/running -> canceled
queued -> blocked
```

Completion is guarded: a canceled worker cannot later commit an artifact.

## Current Production Slice

Implemented:

- durable goals
- durable tasks
- durable workers
- durable artifacts
- durable beliefs
- worker budget
- web-search permission
- external-action permission flag
- worker cancel
- worker retry
- stale completion guard
- V3 live panel
- V3 State drawer JSON

Not complete:

- goal dependency graph UI
- artifact editing
- reviewer worker
- memory consolidation worker
- side-effect tool permissions
- local Node transport parity

