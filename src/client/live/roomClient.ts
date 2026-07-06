import { useRoom as useHttpRoom, useHttpActiveRooms } from "./useRoom";
import { useConvexRoom, useConvexActiveRooms } from "./useConvexRoom";

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

/** Lobby list of joinable rooms (reactive on Convex, polled on HTTP). */
export const useActiveRooms: typeof useHttpActiveRooms = CONVEX_MODE ? useConvexActiveRooms : useHttpActiveRooms;

export { LIVE_BASE, AGENT_SLOTS, DEFAULT_AGENT_COUNT, MAX_AGENT_COUNT, activeSlots, agentIndexFromSlot, isAgentSlot, slotForIndex } from "./useRoom";
export type { Slot, MySlot, RoomUtterance, PublicRoom, RouterModel, RoomAgent, TraceEvent, ActiveRoom, CapabilityProfileId, CapabilityProfileOption } from "./useRoom";
