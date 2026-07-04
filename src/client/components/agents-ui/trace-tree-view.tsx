import * as React from "react";
import { SpanPrimitive, SpanResource, type SpanData } from "@assistant-ui/react-o11y";
import { useAui, AuiProvider, useAuiState } from "@assistant-ui/store";
import { cn } from "@/lib/utils";

export interface TraceTreeViewProps {
  spans: SpanData[];
  className?: string;
  accentColor?: "bad" | "good";
  activeIndex?: number;
}

/** Per-agent identity colours so turn-taking is legible at a glance. */
const AGENT_COLORS: Record<string, string> = {
  "voice-a": "text-sky-300 bg-sky-500/10 ring-sky-400/25",
  "voice-b": "text-violet-300 bg-violet-500/10 ring-violet-400/25",
  "voice-c": "text-amber-300 bg-amber-500/10 ring-amber-400/25",
};

function AgentBadge() {
  const name = useAuiState((s) => s.span.name) ?? "";
  const agentId = name.split(":")[0] ?? name;
  const color = AGENT_COLORS[agentId] ?? "text-muted-foreground bg-muted ring-border";
  return (
    <span
      className={cn(
        "shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold ring-1 ring-inset tabular-nums",
        color,
      )}
    >
      {agentId}
    </span>
  );
}

function SpanRow({ accentColor, isActive }: { accentColor: "bad" | "good"; isActive: boolean }) {
  return (
    <SpanPrimitive.Root
      className={cn(
        "group flex items-start gap-2 rounded-md px-2 py-1.5 transition-all duration-150 cursor-default",
        "border border-transparent",
        isActive
          ? accentColor === "bad"
            ? "bg-destructive/10 border-destructive/30 shadow-[0_0_0_1px_hsl(var(--destructive)/0.25),0_8px_24px_-14px_hsl(var(--destructive)/0.7)]"
            : "bg-success/10 border-success/30 shadow-[0_0_0_1px_hsl(var(--success)/0.25),0_8px_24px_-14px_hsl(var(--success)/0.7)]"
          : "hover:bg-white/[0.03] hover:border-border/60",
      )}
    >
      <SpanPrimitive.StatusIndicator
        className={cn(
          "mt-1 size-2 shrink-0 rounded-full ring-2 ring-inset ring-transparent transition-colors",
          "data-[span-status=running]:bg-warning data-[span-status=running]:animate-pulse-soft",
          accentColor === "bad"
            ? "data-[span-status=completed]:bg-destructive/80 data-[span-status=failed]:bg-destructive"
            : "data-[span-status=completed]:bg-success data-[span-status=failed]:bg-destructive",
          "data-[span-status=skipped]:bg-muted-foreground/50",
          isActive && "ring-current shadow-[0_0_8px_currentColor]",
        )}
      />
      <SpanPrimitive.TypeBadge
        className={cn(
          "mt-px shrink-0 rounded px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide min-w-[52px] text-center border",
          accentColor === "bad"
            ? "bg-destructive/10 text-destructive/90 border-destructive/25"
            : "bg-success/10 text-success/90 border-success/25",
        )}
      />
      <AgentBadge />
      <SpanPrimitive.Name
        className={cn(
          "flex-1 text-xs leading-relaxed break-words min-w-0",
          isActive
            ? accentColor === "bad"
              ? "text-red-100 font-medium"
              : "text-emerald-50 font-medium"
            : "text-foreground/70 group-hover:text-foreground/90",
        )}
      />
    </SpanPrimitive.Root>
  );
}

/**
 * react-o11y renders `components.Span` with NO props — the per-row index lives
 * in context, not props. So we identify the active row by its span *id* (read
 * from the row's own aui state) rather than a prop `index` (which is always
 * undefined). This is what makes the highlight + auto-scroll actually work.
 */
function SpanRowByActive({
  accentColor,
  activeId,
  activeRowRef,
}: {
  accentColor: "bad" | "good";
  activeId: string | null;
  activeRowRef: React.RefObject<HTMLDivElement | null>;
}) {
  const id = useAuiState((s) => s.span.id) as string | undefined;
  const isActive = activeId != null && id === activeId;
  return (
    <div
      ref={isActive ? activeRowRef : undefined}
      className={cn("scroll-mt-6 scroll-mb-6", isActive && "animate-fade-in-up")}
    >
      <SpanRow accentColor={accentColor} isActive={isActive} />
    </div>
  );
}

export function TraceTreeView({ spans, className, accentColor = "good", activeIndex = -1 }: TraceTreeViewProps) {
  const aui = useAui({ span: SpanResource({ spans }) });
  const scrollRef = React.useRef<HTMLDivElement>(null);
  const activeRowRef = React.useRef<HTMLDivElement | null>(null);

  const activeId =
    activeIndex >= 0 && activeIndex < spans.length ? (spans[activeIndex]!.id as string) : null;

  React.useEffect(() => {
    if (activeId && activeRowRef.current) {
      activeRowRef.current.scrollIntoView({ block: "center", behavior: "smooth" });
    }
  }, [activeId]);

  return (
    <AuiProvider value={aui}>
      <div ref={scrollRef} className={cn("flex-1 space-y-0.5 overflow-y-auto px-2.5 py-2.5 font-mono text-xs", className)}>
        {spans.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-muted-foreground/70">
            <div className="size-8 animate-pulse-soft rounded-full border-2 border-dashed border-current" />
            <span className="text-[11px]">Waiting for trace data…</span>
          </div>
        ) : (
          <SpanPrimitive.Children
            components={{
              Span: () => (
                <SpanRowByActive accentColor={accentColor} activeId={activeId} activeRowRef={activeRowRef} />
              ),
            }}
          />
        )}
      </div>
    </AuiProvider>
  );
}

export function compareStepsToSpans(
  steps: { turn: number; actorId: string; speechAct: string; text: string; roomStateSummary: string }[],
  tag: "bad" | "good",
): SpanData[] {
  const now = Date.now();
  const stepDuration = 500;

  // Flat, sequential timeline — every turn is a sibling. (Chaining each turn as
  // a child of the previous produced runaway indentation: 100 turns => 100
  // levels deep => horizontal-scroll soup.)
  return steps.map((step, i) => ({
    id: `${tag}-${step.turn}`,
    parentSpanId: null,
    name: `${step.actorId}: ${step.text}`,
    type: step.speechAct,
    status: "completed" as const,
    startedAt: now + i * stepDuration,
    endedAt: now + (i + 1) * stepDuration,
    latencyMs: stepDuration,
  }));
}
