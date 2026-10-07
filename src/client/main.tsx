import ReactDOM from "react-dom/client";
import { ConvexReactClient } from "convex/react";
import { Application, convexUrl } from "./Application";
import App from "./App";
import LiveRoom from "./live/LiveRoom";

// Simple path-based routing: /demo -> the bad-vs-good comparison demo,
// everything else (incl. ?room=… deep links) -> the live voice room.
const isDemo = window.location.pathname.startsWith("/demo");

// Hosted build: VITE_CONVEX_URL selects the fully reactive Convex client
// (WebSocket subscriptions). Local build leaves it unset -> HTTP client
// against the Node server, no provider needed.
const client = convexUrl ? new ConvexReactClient(convexUrl) : undefined;
const app = <Application client={client}>{isDemo ? <App /> : <LiveRoom />}</Application>;
const root = document.getElementById("root")!;
const publicLobby = window.location.pathname === "/" && !new URLSearchParams(window.location.search).get("room");

if (publicLobby) ReactDOM.hydrateRoot(root, app);
else ReactDOM.createRoot(root).render(app);
