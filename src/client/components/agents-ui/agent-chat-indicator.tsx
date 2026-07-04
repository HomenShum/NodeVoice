import * as React from "react";
import { cn } from "@/lib/utils";
import type { AgentState } from "./agent-audio-visualizer-bar";

export interface AgentChatIndicatorProps {
  state: AgentState;
  className?: string;
}

const stateLabels: Record<AgentState, string> = {
  connecting: "Connecting",
  listening: "Idle · listening",
  speaking: "Speaking",
  thinking: "Thinking",
};

const stateStyles: Record<AgentState, { dot: string; text: string; ring: string }> = {
  connecting: { dot: "bg-warning", text: "text-warning", ring: "ring-warning/30" },
  listening: { dot: "bg-primary", text: "text-primary", ring: "ring-primary/30" },
  speaking: { dot: "bg-success", text: "text-success", ring: "ring-success/30" },
  thinking: { dot: "bg-sky-400", text: "text-sky-300", ring: "ring-sky-400/30" },
};

export function AgentChatIndicator({ state, className }: AgentChatIndicatorProps) {
  const s = stateStyles[state];
  return (
    <div
      className={cn(
        "inline-flex items-center gap-2 rounded-full border border-border bg-elevated/60 px-3 py-1 text-[11px] font-medium ring-1 ring-inset",
        s.ring,
        s.text,
        className,
      )}
    >
      <span className="relative flex size-2">
        <span className={cn("absolute inline-flex h-full w-full animate-ping rounded-full opacity-60", s.dot)} />
        <span className={cn("relative inline-flex size-2 rounded-full", s.dot)} />
      </span>
      {stateLabels[state]}
    </div>
  );
}
