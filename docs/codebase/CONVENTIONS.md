# Conventions

## Three TypeScript projects, one command

| Project | Config | Covers | Module resolution |
|---|---|---|---|
| server | `tsconfig.json` | `src/**` except `src/client`, plus `tests/**` | `NodeNext` — relative imports carry a `.js` extension |
| browser | `tsconfig.client.json` | `src/client/**` | `bundler`; `@/` maps to `src/client/` |
| Convex | `convex/tsconfig.json` | `convex/**` | `Bundler`, `isolatedModules` |

`npm run doctor` runs all three. It gained the Convex project in Wave 3; before
that, `convex/` was typechecked by nothing in `package.json`, which is a bad
place to be when `convex/` is what the hosted deployment runs.

**Why `.js` on TypeScript imports.** `import { x } from "./foo.js"` resolves to
`foo.ts`. NodeNext requires the extension; esbuild, Vite and the Convex bundler
all perform the same `.js` to `.ts` substitution. That is what lets `convex/`
and `src/client/` both import `src/core/*` from a single copy instead of keeping
their own.

## Strictness

`strict` and `noUncheckedIndexedAccess` are on in all three projects. That is
why array access is written `slots[i]!` where the index is provably in range.
The `!` is a claim; if you cannot justify it, the index is not provably in
range and the code needs a real check.

## Naming

- Domain nouns, not layer nouns: `RoomState`, `Utterance`, `SpeechAct`,
  `AgentIdentity`, `CountTask`, `HumanSteeringIntent`. There is no `Manager`,
  `Service`, `Helper` or `Util` in this codebase; adding one should feel wrong.
- A **slot** is a seat in a room (`"agent-007"`). A **participant** is a device
  currently sitting in one. Different things, and the names never mix.
- `valid*` functions (`validModel`, `validProfile`, `validAgentCount`) take
  untrusted input and always return something safe. They never throw.
- `derive*` and `parse*` functions return `null` when the input did not contain
  the thing. They never guess a value the speaker did not say.

## Comments

Comments say **why**, and they carry the measurement or the bug that forced the
code. `src/core/numberWords.ts` explains that "One hundred" is two tokens and
what stalling at 99 forever looked like. Keep that style: a comment restating
the code should be deleted; a comment recording a defect is load bearing.

## Errors

Throw `Error` with a message a person can act on, such as
`"OPENAI_API_KEY is not configured on the server"`. Never return 2xx on a
failure path. Never substitute a plausible value for a missing one — the whole
product is an argument about what happens when a system pretends to know
something it does not.

## Generated code

`src/client/components/ui/*` comes from `npx shadcn add` (configured by
`components.json`). Its export surface is left exactly as generated even where
knip reports parts of it unused, so the next `shadcn add` does not produce a
conflicting diff. `convex/_generated/` is written by the Convex CLI and is never
edited by hand.
