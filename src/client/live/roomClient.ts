import { useRoom as useHttpRoom } from "./useRoom";
import { useConvexRoom } from "./useConvexRoom";

/**
 * Build-time transport selection:
 *   VITE_CONVEX_URL set   → fully reactive Convex client (WebSocket subscription,
 *                           no SSE, no polling, no tunnel) — the hosted build.
 *   VITE_CONVEX_URL empty → HTTP client against the local Node server
 *                           (SSE with polling fallback) — `npm run live`.
 *
 * The choice is a module-level constant, so hook order is stable for the
 * lifetime of the app (safe conditional hook selection).
 */
export const CONVEX_MODE = Boolean(import.meta.env.VITE_CONVEX_URL);

export const useRoom: typeof useHttpRoom = CONVEX_MODE
  ? (useConvexRoom as unknown as typeof useHttpRoom)
  : useHttpRoom;

export { LIVE_BASE } from "./useRoom";
export type { Slot, MySlot, RoomUtterance, PublicRoom, RouterModel, RoomAgent, TraceEvent } from "./useRoom";
