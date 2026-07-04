import * as React from "react";
import { cn } from "@/lib/utils";

export type AgentState = "connecting" | "listening" | "speaking" | "thinking";

export interface AgentAudioVisualizerBarProps {
  state?: AgentState;
  className?: string;
  barCount?: number;
}

const STATE_TINT: Record<AgentState, string> = {
  connecting: "hsl(38 92% 60%)",
  listening: "hsl(250 84% 68%)",
  speaking: "hsl(152 62% 52%)",
  thinking: "hsl(199 89% 60%)",
};

export function AgentAudioVisualizerBar({
  state = "listening",
  className,
  barCount = 48,
}: AgentAudioVisualizerBarProps) {
  const [bars, setBars] = React.useState<number[]>(() =>
    Array.from({ length: barCount }, () => Math.random()),
  );

  // keep the bar array in sync if barCount changes
  React.useEffect(() => {
    setBars((prev) =>
      prev.length === barCount ? prev : Array.from({ length: barCount }, () => Math.random()),
    );
  }, [barCount]);

  React.useEffect(() => {
    const interval = setInterval(() => {
      setBars((prev) =>
        prev.map((_, i) => {
          // centre bars swing wider than the edges for a natural waveform
          const centre = 1 - Math.abs(i - prev.length / 2) / (prev.length / 2);
          const envelope = 0.35 + centre * 0.65;
          if (state === "connecting") return (0.08 + Math.random() * 0.12) * envelope;
          if (state === "listening") return (0.06 + Math.random() * 0.22) * envelope;
          if (state === "speaking") return (0.25 + Math.random() * 0.75) * envelope;
          if (state === "thinking") return (0.12 + Math.random() * 0.22) * envelope;
          return Math.random() * 0.5 * envelope;
        }),
      );
    }, 90);
    return () => clearInterval(interval);
  }, [state]);

  const tint = STATE_TINT[state];

  return (
    <div className={cn("flex h-10 items-center justify-center gap-[3px] px-4", className)}>
      {bars.map((value, i) => (
        <div
          key={i}
          className="w-[3px] rounded-full transition-all duration-100 ease-out"
          style={{
            height: `${Math.max(6, value * 100)}%`,
            background: `linear-gradient(to top, ${tint}, ${tint}00)`,
            opacity: 0.35 + value * 0.65,
            boxShadow: value > 0.6 ? `0 0 8px ${tint}66` : "none",
          }}
        />
      ))}
    </div>
  );
}
