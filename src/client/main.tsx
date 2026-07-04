import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import LiveRoom from "./live/LiveRoom";
import "./index.css";

// Simple path-based routing: /demo -> the bad-vs-good comparison demo,
// everything else (incl. ?room=… deep links) -> the live voice room.
const isDemo = window.location.pathname.startsWith("/demo");

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>{isDemo ? <App /> : <LiveRoom />}</React.StrictMode>,
);
