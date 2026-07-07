# Room OS Skills

Skills are durable capabilities the V3 harness can schedule. They are not roleplay labels.

Each skill has:

- input contract
- context pack
- tool permissions
- budget cost
- output artifact
- completion verifier
- retry/cancel behavior

## Current Live Skills

### deterministic_count

Purpose: execute exact count tasks without spending an LLM call per number.

Input:

- count start
- count target
- active room count state

Output:

- count execution artifact
- reducer-owned spoken turns

Verifier:

- every committed spoken number must equal the reducer's next number
- room completes exactly at target

### web_research

Purpose: gather current external context for a goal.

Input:

- room goal
- worker goal
- task title

Tools:

- OpenAI Responses API
- hosted web_search

Output:

- markdown research artifact
- source list when available
- belief summary with confidence

Policy:

- blocked when `permissionWebResearch=false`
- consumes one worker budget unit

### execution_plan

Purpose: turn a goal into an actionable plan.

Input:

- room goal
- worker goal
- task title

Tools:

- OpenAI model configured for the room

Output:

- markdown plan artifact
- belief summary with confidence

Policy:

- consumes one worker budget unit

## Planned Skills

### reviewer

Checks artifacts for missing constraints, stale claims, unsafe promises, and unsupported recommendations.

### artifact_editor

Updates an existing artifact instead of creating a new one.

### dependency_planner

Builds goal/task dependencies and marks blocked prerequisites.

### outreach_builder

Creates outreach copy and lead lists, gated by external-action permissions before any message is sent.

### code_builder

Works inside a repository and produces patches, gated by filesystem and deployment permissions.

### memory_consolidator

Turns failures, traces, and user corrections into reusable regression tests and playbook updates.

