import React from "react";
import ReactDOM from "react-dom/client";
import { ConvexProvider, ConvexReactClient } from "convex/react";
import App from "./App";
import LiveRoom from "./live/LiveRoom";
import "./index.css";

// Simple path-based routing: /demo -> the bad-vs-good comparison demo,
// everything else (incl. ?room=… deep links) -> the live voice room.
const isDemo = window.location.pathname.startsWith("/demo");

// Hosted build: VITE_CONVEX_URL selects the fully reactive Convex client
// (WebSocket subscriptions). Local build leaves it unset -> HTTP client
// against the Node server, no provider needed.
const convexUrl = (import.meta.env.VITE_CONVEX_URL as string | undefined) ?? "";

const app = <React.StrictMode>{isDemo ? <App /> : <LiveRoom />}</React.StrictMode>;

ReactDOM.createRoot(document.getElementById("root")!).render(
  convexUrl ? <ConvexProvider client={new ConvexReactClient(convexUrl)}>{app}</ConvexProvider> : app,
);
