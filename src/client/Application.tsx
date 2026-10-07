import * as React from "react";
import { ConvexProvider, type ConvexReactClient } from "convex/react";

export const convexUrl = (import.meta.env.VITE_CONVEX_URL as string | undefined) ?? "";

// Shared composition keeps the prerendered lobby and initial browser tree equal.
export function Application({ children, client }: { children: React.ReactNode; client?: ConvexReactClient }) {
  const app = <React.StrictMode>{children}</React.StrictMode>;
  return client ? <ConvexProvider client={client}>{app}</ConvexProvider> : app;
}
