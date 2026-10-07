import { renderToString } from "react-dom/server";
import { ConvexReactClient } from "convex/react";
import { Application, convexUrl } from "./Application";
import LiveRoom from "./live/LiveRoom";

export async function renderPublicLobby() {
  const client = convexUrl ? new ConvexReactClient(convexUrl) : undefined;
  try {
    // Effects and room operations never run during this initial public render.
    return renderToString(<Application client={client}><LiveRoom /></Application>);
  } finally {
    await client?.close();
  }
}
