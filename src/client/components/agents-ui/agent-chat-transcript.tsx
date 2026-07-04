import * as React from "react";
import { Boxes, User, TriangleAlert, FileText, Table2, Layers, ScrollText } from "lucide-react";
import { cn } from "@/lib/utils";

export interface TranscriptMessage {
  id: string;
  role: "agent" | "user" | "system";
  name: string;
  content: string;
  timestamp?: string;
  metadata?: {
    speechAct?: string;
    stateSummary?: string;
    tag?: "bad" | "good" | "node" | "info";
  };
}

export interface AgentChatTranscriptProps {
  messages: TranscriptMessage[];
  className?: string;
  autoScroll?: boolean;
}

const ARTIFACT_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  context_bundle: Layers,
  grounded_answer: FileText,
  spreadsheet_delta: Table2,
  notebook_memo: ScrollText,
};

export function AgentChatTranscript({
  messages,
  className,
  autoScroll = true,
}: AgentChatTranscriptProps) {
  const scrollRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (autoScroll && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, autoScroll]);

  return (
    <div
      ref={scrollRef}
      className={cn("flex-1 overflow-y-auto px-4 py-5", className)}
    >
      {messages.length === 0 ? (
        <div className="flex h-full flex-col items-center justify-center gap-3 text-muted-foreground">
          <div className="flex size-12 items-center justify-center rounded-xl border border-border bg-elevated/60">
            <Boxes className="size-6 text-primary/70" />
          </div>
          <div className="text-center">
            <p className="text-sm font-medium text-foreground">NodeAgent artifact chain</p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Enter a goal below to run the four-frame loop.
            </p>
          </div>
        </div>
      ) : (
        <div className="mx-auto flex max-w-3xl flex-col gap-3">
          {messages.map((msg, i) => (
            <TranscriptLine key={msg.id} message={msg} index={i} />
          ))}
        </div>
      )}
    </div>
  );
}

function TranscriptLine({ message, index }: { message: TranscriptMessage; index: number }) {
  const isError = message.metadata?.tag === "bad" || message.name === "error";
  const isUser = message.role === "user";
  const isSystem = message.role === "system" && !isError;
  const Icon = ARTIFACT_ICONS[message.name] ?? (isUser ? User : Boxes);

  if (isSystem) {
    return (
      <div className="flex items-center gap-2 py-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
        <span className="h-px flex-1 bg-border" />
        {message.content}
        <span className="h-px flex-1 bg-border" />
      </div>
    );
  }

  if (isError) {
    return (
      <div className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
        <TriangleAlert className="mt-0.5 size-4 shrink-0" />
        <pre className="whitespace-pre-wrap break-words font-mono">{message.content}</pre>
      </div>
    );
  }

  if (isUser) {
    return (
      <div className="flex justify-end">
        <div className="flex max-w-[85%] items-start gap-2 rounded-xl rounded-tr-sm border border-primary/30 bg-primary/10 px-3.5 py-2.5">
          <span className="text-sm leading-relaxed text-foreground">{message.content}</span>
        </div>
      </div>
    );
  }

  // agent artifact card
  return (
    <div
      className="animate-fade-in-up rounded-xl border border-border bg-card/70 p-3.5 shadow-panel"
      style={{ animationDelay: `${Math.min(index * 60, 400)}ms` }}
    >
      <div className="mb-2 flex items-center gap-2">
        <div className="flex size-7 items-center justify-center rounded-md border border-primary/25 bg-primary/10 text-primary">
          <Icon className="size-4" />
        </div>
        <span className="font-mono text-xs font-semibold text-foreground">{message.name}</span>
        {message.metadata?.speechAct && (
          <span className="ml-auto rounded-full border border-border-strong px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
            {message.metadata.speechAct}
          </span>
        )}
      </div>
      <div className="whitespace-pre-wrap break-words pl-9 font-mono text-xs leading-relaxed text-foreground/80">
        {message.content}
      </div>
      {message.metadata?.stateSummary && (
        <div className="mt-1.5 pl-9 text-[10px] text-muted-foreground">
          {message.metadata.stateSummary}
        </div>
      )}
    </div>
  );
}
