import * as React from "react";
import { GitCompareArrows, Boxes, Play, LoaderCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export interface AgentControlBarProps {
  mode: "compare" | "node";
  onModeChange: (mode: "compare" | "node") => void;
  availableModes?: ("compare" | "node")[];
  onSend: () => void;
  inputValue: string;
  onInputChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
}

export function AgentControlBar({
  mode,
  onModeChange,
  availableModes,
  onSend,
  inputValue,
  onInputChange,
  placeholder,
  disabled,
  className,
}: AgentControlBarProps) {
  const allModes = [
    { key: "compare" as const, label: "Compare", icon: GitCompareArrows },
    { key: "node" as const, label: "NodeAgent", icon: Boxes },
  ];
  const modes = availableModes ? allModes.filter((m) => availableModes.includes(m.key)) : allModes;

  return (
    <div className={cn("shrink-0 border-t border-border bg-card/80 px-4 py-3 backdrop-blur", className)}>
      <div className="mx-auto flex max-w-[1400px] flex-wrap items-center gap-2.5">
        {/* Segmented mode control */}
        {modes.length > 1 && (
          <div className="flex shrink-0 items-center gap-0.5 rounded-lg border border-border bg-background/60 p-0.5">
            {modes.map((m) => {
              const Icon = m.icon;
              const active = mode === m.key;
              return (
                <button
                  key={m.key}
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-all",
                    active
                      ? "bg-elevated text-foreground shadow-[0_1px_0_0_hsl(0_0%_100%/0.06)_inset,0_4px_12px_-6px_hsl(0_0%_0%/0.6)]"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                  onClick={() => onModeChange(m.key)}
                  aria-pressed={active}
                >
                  <Icon className="size-3.5" />
                  {m.label}
                </button>
              );
            })}
          </div>
        )}

        <div className="relative flex-1 basis-40 min-w-40">
          <Input
            value={inputValue}
            onChange={(e) => onInputChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") onSend();
            }}
            placeholder={placeholder}
            disabled={disabled}
            className="h-10 pr-3"
          />
        </div>

        <Button onClick={onSend} disabled={disabled} size="lg" className="shrink-0">
          {disabled ? (
            <LoaderCircle className="size-4 animate-spin" />
          ) : (
            <Play className="size-4 fill-current" />
          )}
          {disabled ? "Running" : "Run"}
        </Button>
      </div>
    </div>
  );
}
