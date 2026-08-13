# Stack

What is actually installed and why. Versions are the ranges in `package.json`;
`npm ci` reports **104 packages** on a clean checkout.

## Runtime

| Thing | Version | What it does here |
|---|---|---|
| Node | 22 (CI uses 20) | Runs the server, the CLI demos and the tests. `src/server.ts` uses only `node:http` — no Express, no Fastify. |
| TypeScript | latest | Three separate projects, all `strict` + `noUncheckedIndexedAccess`. See CONVENTIONS.md. |
| tsx | latest | Runs `.ts` directly (`npm start`, `npm run demo`). No build step for the server. |

## Direct dependencies — all six

| Package | Used by | Why it is not hand-rolled |
|---|---|---|
| `react`, `react-dom` | `src/client/**` | The browser client. |
| `convex` | `convex/**`, `src/client/live/useConvexRoom.ts` | The hosted backend: database, WebSocket subscriptions, file storage and server functions in one. Replaces a database, a realtime layer and an object store. |
| `qrcode-generator` | `src/client/live/Qr.tsx` | Renders the join code a phone scans. ~2 kB; writing a QR encoder would be the opposite of this repo's rules. |
| `@assistant-ui/store`, `@assistant-ui/react-o11y` | `src/client/components/agents-ui/trace-tree-view.tsx` | Renders the agent trace tree. |

Eleven further dependencies were listed here and imported by nothing; Wave 3
removed them (`docs/SIMPLIFICATION_REPORT.md`).

## Build and test tooling (devDependencies)

`vite` + `@vitejs/plugin-react` build the browser client into `dist/`.
`vitest` runs the tests. `tailwindcss` v4 (with `@tailwindcss/postcss`,
`postcss`, `autoprefixer`) styles the client. `clsx`, `tailwind-merge`,
`class-variance-authority` and `lucide-react` are the shadcn/ui primitives'
dependencies (`components.json` configures that generator).

## Not installed on purpose

- **No HTTP framework** — `node:http` and one `handleLive` router are enough for
  eight routes.
- **No state library** — the client uses `React.useState` and two hooks.
- **No test framework beyond vitest** — no mocking library; the live-room test
  starts a real server on an ephemeral port.
- **`playwright`** is installed on demand (`npm i --no-save playwright`) by the
  two capture scripts, so browser binaries never enter CI install time.
