import * as React from "react";
import {
  Info,
  Smartphone,
  Server,
  Repeat,
  CircleCheck,
  ArrowRight,
  Boxes,
  Radio,
  ListTree,
  Zap,
  Cpu,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { AgentChatTranscript, type TranscriptMessage } from "@/components/agents-ui/agent-chat-transcript";
import { TraceTreeView, compareStepsToSpans } from "@/components/agents-ui/trace-tree-view";
import { AgentControlBar } from "@/components/agents-ui/agent-control-bar";
import { AgentAudioVisualizerBar, type AgentState } from "@/components/agents-ui/agent-audio-visualizer-bar";
import { AgentChatIndicator } from "@/components/agents-ui/agent-chat-indicator";
import { deriveBadFooter } from "../compare/badFooter";

interface ModelOption {
  id: string;
  label: string;
  bucket: string;
  ollamaModel: string;
  parameterSize: string;
  hardwareTier: string;
  availability: string;
  recommendedFor: string[];
  pull: string;
  notes: string;
}

type CompareSource = "deterministic" | "ollama" | "openai";

const DEMO_API_BASE =
  (import.meta.env.VITE_DEMO_API_BASE as string | undefined) ??
  ((import.meta.env.VITE_CONVEX_URL as string | undefined) ? ((import.meta.env.VITE_CONVEX_SITE_URL as string | undefined) ?? "") : "");
const DEMO_REMOTE_SOURCES_ENABLED = (import.meta.env.VITE_DEMO_ENABLE_REMOTE_SOURCES as string | undefined) === "true";
const DEMO_HOSTED_ONLY = Boolean(DEMO_API_BASE) && !DEMO_REMOTE_SOURCES_ENABLED;

function demoApi(path: string): string {
  return DEMO_API_BASE ? `${DEMO_API_BASE.replace(/\/$/, "")}${path}` : path;
}

interface BadAgentPrivateState {
  agentId: string;
  heardCount: number;
  spokeCount: number;
  believesCurrent: number;
  lastClassifiedAs: string;
  nextIntent: string;
}

interface CompareProvenance {
  mode: CompareSource;
  modelId: string | null;
  bad: string;
  good: string;
}

interface CompareStep {
  turn: number;
  actorId: string;
  speechAct: string;
  text: string;
  roomStateSummary: string;
  agentStates?: BadAgentPrivateState[];
}

interface NodeResult {
  ok: boolean;
  artifacts: { kind: string; title: string; payload?: { markdown?: string } }[];
  model?: { cells: unknown[] };
}

function bucketPrefix(bucket: string): string {
  if (bucket === "latest_edge" || bucket === "latest_local") return "LATEST · ";
  if (bucket === "practical_stable") return "STABLE · ";
  return "";
}

export default function App() {
  const [voiceModels, setVoiceModels] = React.useState<ModelOption[]>([]);
  const [nodeModels, setNodeModels] = React.useState<ModelOption[]>([]);
  const [voiceModelId, setVoiceModelId] = React.useState("");
  const [nodeModelId, setNodeModelId] = React.useState("");
  const [target, setTarget] = React.useState(100);
  const [turns, setTurns] = React.useState(100);
  const [source, setSource] = React.useState<CompareSource>("deterministic");
  const [mode, setMode] = React.useState<"compare" | "node">("compare");
  const [inputValue, setInputValue] = React.useState("");
  const [agentState, setAgentState] = React.useState<AgentState>("listening");
  const [running, setRunning] = React.useState(false);
  const [modelNote, setModelNote] = React.useState("");
  const [modelError, setModelError] = React.useState("");

  const [badSteps, setBadSteps] = React.useState<CompareStep[]>([]);
  const [goodSteps, setGoodSteps] = React.useState<CompareStep[]>([]);
  const [provenance, setProvenance] = React.useState<CompareProvenance | null>(null);
  const [nodeMessages, setNodeMessages] = React.useState<TranscriptMessage[]>([]);
  const [compareLoaded, setCompareLoaded] = React.useState(false);
  const [currentStepIndex, setCurrentStepIndex] = React.useState(-1);

  React.useEffect(() => {
    loadModels();
  }, []);

  React.useEffect(() => {
    if (voiceModels.length > 0) {
      const m = voiceModels.find((m) => m.id === voiceModelId) ?? voiceModels[0];
      if (m) setModelNote(`${m.ollamaModel} · ${m.parameterSize} · ${m.hardwareTier} · ${m.availability}`);
    }
  }, [voiceModelId, voiceModels]);

  async function loadModels() {
    try {
      const res = await fetch(demoApi("/api/models"));
      if (!res.ok) throw new Error(`models request failed: ${res.status}`);
      const data = await res.json();
      const voice = Array.isArray(data?.voice) ? data.voice : [];
      const node = Array.isArray(data?.nodeagent) ? data.nodeagent : [];
      setVoiceModels(voice.filter((m: ModelOption) => m.recommendedFor?.includes("voice")));
      setNodeModels(node.filter((m: ModelOption) => m.recommendedFor?.includes("nodeagent")));
      if (data?.defaults?.voice) setVoiceModelId(data.defaults.voice);
      if (data?.defaults?.nodeagent) setNodeModelId(data.defaults.nodeagent);
      setModelError("");
    } catch (err) {
      setModelError("Could not load models — is the server running? Falling back to defaults.");
    }
  }

  function handleModeChange(newMode: "compare" | "node") {
    if (DEMO_HOSTED_ONLY && newMode === "node") return;
    setMode(newMode);
    if (newMode === "node") {
      setInputValue("Build a local-first agent room that prevents acknowledgement loops and emits cited artifacts.");
    } else {
      setInputValue("");
    }
  }

  async function handleSend() {
    if (mode === "compare") {
      await runCompare();
    } else {
      await runNode(inputValue.trim());
    }
  }

  async function runCompare() {
    setMode("compare");
    setRunning(true);
    setAgentState("thinking");
    setCompareLoaded(false);
    const requestedSource = DEMO_HOSTED_ONLY ? "deterministic" : source;

    try {
      const res = await fetch(demoApi("/compare/demo"), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ target, turns, source: requestedSource, useOllama: requestedSource === "ollama", model: voiceModelId }),
      });
      const data = await res.json();
      if (!res.ok || data?.ok === false) {
        throw new Error(String(data?.error ?? `compare request failed: ${res.status}`));
      }
      const bad = data.bad as CompareStep[];
      const good = data.good as CompareStep[];
      setBadSteps(bad);
      setGoodSteps(good);
      setProvenance((data.provenance as CompareProvenance | undefined) ?? null);
      setCompareLoaded(true);
      setCurrentStepIndex(-1);
      await speakGoodSteps(good);
    } catch (err) {
      // Clear on-screen error event (e.g. openai source without a server key).
      setBadSteps([{ turn: 0, actorId: "error", speechAct: "error", text: String(err), roomStateSummary: "" }]);
      setGoodSteps([]);
      setProvenance(null);
      setCompareLoaded(true);
      setAgentState("listening");
    }
    setRunning(false);
  }

  async function speakGoodSteps(steps: CompareStep[]) {
    const synth = window.speechSynthesis;
    if (!synth) {
      setAgentState("listening");
      return;
    }
    synth.cancel();

    const voices = synth.getVoices();
    const agentVoiceConfig: Record<string, { voice?: SpeechSynthesisVoice; pitch: number; rate: number }> = {
      "voice-a": { voice: voices.find((v) => v.lang.startsWith("en") && v.name.toLowerCase().includes("male")) ?? voices[0], pitch: 0.7, rate: 2.2 },
      "voice-b": { voice: voices.find((v) => v.lang.startsWith("en") && v.name.toLowerCase().includes("female")) ?? voices[1] ?? voices[0], pitch: 1.4, rate: 2.0 },
      "voice-c": { voice: voices.find((v) => v.lang.startsWith("en") && !v.name.toLowerCase().includes("male") && !v.name.toLowerCase().includes("female")) ?? voices[2] ?? voices[0], pitch: 1.0, rate: 2.5 },
    };

    for (let i = 0; i < steps.length; i += 1) {
      const step = steps[i]!;
      setCurrentStepIndex(i);
      setAgentState("speaking");
      const cfg = agentVoiceConfig[step.actorId] ?? { pitch: 1.0, rate: 2.2 };
      await new Promise<void>((resolve) => {
        // Watchdog: never let the run hang if onend/onerror never fires
        // (backgrounded tab, interrupted speech, flaky TTS engine).
        let settled = false;
        const finish = () => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          resolve();
        };
        const utterance = new SpeechSynthesisUtterance(step.text);
        if (cfg.voice) utterance.voice = cfg.voice;
        utterance.rate = cfg.rate;
        utterance.pitch = cfg.pitch;
        utterance.onend = finish;
        utterance.onerror = finish;
        const estMs = Math.min(6000, 500 + (step.text.length * 700) / cfg.rate);
        const timer = setTimeout(finish, estMs);
        synth.speak(utterance);
      });
      setAgentState("listening");
      await new Promise((r) => setTimeout(r, 60));
    }
    setAgentState("listening");
  }

  async function runNode(goal: string) {
    if (DEMO_HOSTED_ONLY) return;
    if (!goal) return;
    setRunning(true);
    setAgentState("thinking");
    setNodeMessages([
      { id: "node-header", role: "system", name: "", content: "NodeAgent artifact chain", metadata: { tag: "node" } },
      { id: "user-goal", role: "user", name: "user", content: goal, metadata: { tag: "node", speechAct: "goal" } },
    ]);

    try {
      const res = await fetch(demoApi("/nodeagents/run"), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ goal, useOllama: source === "ollama", model: nodeModelId }),
      });
      const data: NodeResult = await res.json();
      if (!res.ok || data.ok === false) {
        setNodeMessages((prev) => [...prev, { id: "err", role: "system", name: "error", content: JSON.stringify(data), metadata: { tag: "bad" } }]);
      } else {
        const newMessages: TranscriptMessage[] = [];
        for (const artifact of data.artifacts) {
          const memo = artifact.kind === "notebook_memo" ? artifact.payload?.markdown ?? "" : "";
          newMessages.push({
            id: `artifact-${artifact.kind}`,
            role: "agent",
            name: artifact.kind,
            content: memo || artifact.title,
            metadata: { tag: "node", speechAct: "artifact" },
          });
        }
        setNodeMessages((prev) => [...prev, ...newMessages]);
      }
      setAgentState("listening");
    } catch (err) {
      setNodeMessages((prev) => [...prev, { id: "err", role: "system", name: "error", content: String(err), metadata: { tag: "bad" } }]);
      setAgentState("listening");
    }
    setRunning(false);
  }

  const placeholder =
    mode === "compare"
      ? "Press Run to start the side-by-side comparison demo…"
      : "Type a goal for the NodeAgent artifact chain…";

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-background text-foreground">
      {/* ── Top bar ─────────────────────────────────────────────── */}
      <header className="z-20 flex shrink-0 items-center gap-3 border-b border-border bg-card/80 px-4 py-2.5 backdrop-blur">
        <div className="flex shrink-0 items-center gap-2.5">
          <div className="flex size-8 items-center justify-center rounded-lg bg-gradient-to-br from-primary to-primary/70 shadow-[0_4px_16px_-4px_hsl(var(--primary)/0.8)]">
            <Radio className="size-4.5 text-primary-foreground" strokeWidth={2.25} />
          </div>
          <div className="leading-tight">
            <h1 className="whitespace-nowrap text-sm font-bold tracking-tight">Room OS</h1>
            <p className="hidden text-[10px] text-muted-foreground sm:block">shared-state agent console</p>
          </div>
        </div>

        <div className="flex min-w-0 flex-1 items-center justify-end gap-2 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          <Select
            label="Voice"
            value={voiceModelId}
            onChange={(e) => setVoiceModelId(e.target.value)}
            title="Voice model"
            className="w-[190px]"
          >
            {voiceModels.map((m) => (
              <option key={m.id} value={m.id}>
                {bucketPrefix(m.bucket)}
                {m.label}
              </option>
            ))}
          </Select>
          {!DEMO_HOSTED_ONLY && (
            <Select
              label="Node"
              value={nodeModelId}
              onChange={(e) => setNodeModelId(e.target.value)}
              title="NodeAgent model"
              className="hidden w-[190px] lg:flex"
            >
              {nodeModels.map((m) => (
                <option key={m.id} value={m.id}>
                  {bucketPrefix(m.bucket)}
                  {m.label}
                </option>
              ))}
            </Select>
          )}
          <NumberField label="N" value={target} min={3} max={100} onChange={setTarget} />
          <NumberField label="Turns" value={turns} min={3} max={100} onChange={setTurns} />
          {!DEMO_HOSTED_ONLY && (
            <Select
              label="Source"
              value={source}
              onChange={(e) => setSource(e.target.value as CompareSource)}
              title="Utterance source: deterministic sim, local Ollama, or server-side OpenAI"
              className="w-[150px]"
            >
              <option value="deterministic">Sim (scripted)</option>
              <option value="ollama">Ollama (local)</option>
              <option value="openai">OpenAI (live)</option>
            </Select>
          )}
        </div>
      </header>

      {/* ── Telemetry strip ─────────────────────────────────────── */}
      <div className="z-10 flex shrink-0 items-center gap-3 border-b border-border bg-background/60 px-4 py-1.5">
        <AgentChatIndicator state={agentState} />
        <div className="hidden min-w-0 flex-1 sm:block">
          <AgentAudioVisualizerBar state={agentState} className="h-8" />
        </div>
        {modelError ? (
          <div className="flex shrink-0 items-center gap-1.5 font-mono text-[10px] text-destructive">
            <Info className="size-3" />
            {modelError}
          </div>
        ) : (
          modelNote && (
            <div className="hidden shrink-0 items-center gap-1.5 font-mono text-[10px] text-muted-foreground md:flex">
              <Cpu className="size-3" />
              {modelNote}
            </div>
          )
        )}
      </div>

      {/* ── Main ────────────────────────────────────────────────── */}
      {mode === "compare" ? (
        <CompareView
          badSteps={badSteps}
          goodSteps={goodSteps}
          target={target}
          currentStepIndex={currentStepIndex}
          loaded={compareLoaded}
          running={running}
          onRun={runCompare}
          provenance={provenance}
        />
      ) : (
        <AgentChatTranscript messages={nodeMessages} className="border-0" />
      )}

      {/* ── Control bar ─────────────────────────────────────────── */}
      <AgentControlBar
        mode={mode}
        onModeChange={handleModeChange}
        availableModes={DEMO_HOSTED_ONLY ? ["compare"] : undefined}
        onSend={handleSend}
        inputValue={inputValue}
        onInputChange={setInputValue}
        placeholder={placeholder}
        disabled={running}
      />
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────── */
/*  Header controls                                                     */
/* ────────────────────────────────────────────────────────────────── */

function NumberField({
  label,
  value,
  onChange,
  min,
  max,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  min: number;
  max: number;
}) {
  return (
    <label className="flex h-9 items-center gap-1.5 rounded-md border border-border bg-elevated/70 pl-2.5 pr-1 transition-colors hover:border-border-strong focus-within:border-primary/60 focus-within:ring-2 focus-within:ring-ring/40">
      <span className="select-none text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
        {label}
      </span>
      <input
        type="number"
        min={min}
        max={max}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-10 bg-transparent text-right text-xs font-semibold tabular-nums text-foreground outline-none"
      />
    </label>
  );
}

/* ────────────────────────────────────────────────────────────────── */
/*  Compare view                                                        */
/* ────────────────────────────────────────────────────────────────── */

function CompareView({
  badSteps,
  goodSteps,
  target,
  currentStepIndex,
  loaded,
  running,
  onRun,
  provenance,
}: {
  badSteps: CompareStep[];
  goodSteps: CompareStep[];
  target: number;
  currentStepIndex: number;
  loaded: boolean;
  running: boolean;
  onRun: () => void;
  provenance: CompareProvenance | null;
}) {
  if (!loaded) {
    return <CompareHero running={running} onRun={onRun} />;
  }

  const goodCurrent = currentStepIndex >= 0 && currentStepIndex < goodSteps.length ? goodSteps[currentStepIndex] : null;
  const goodState = goodCurrent ? parseRoomState(goodCurrent.roomStateSummary) : null;
  const progressNum = goodState?.current ?? 0;
  const progressPct = Math.min(100, (progressNum / target) * 100);
  const done = progressNum >= target;

  // Live streaming: while running, reveal turns one-by-one in lockstep on both
  // panels (the bad panel loops while the good panel advances). When finished,
  // show the full trace.
  const streaming = running && currentStepIndex >= 0;
  const revealCount = running ? Math.max(0, currentStepIndex + 1) : badSteps.length;
  const revealedBad = badSteps.slice(0, revealCount);
  const revealedGood = goodSteps.slice(0, revealCount);

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      {/* Story banner */}
      <div className="relative shrink-0 overflow-hidden border-b border-border">
        <div className="absolute inset-0 bg-gradient-to-r from-primary/12 via-background to-success/10" />
        <div className="bg-grid absolute inset-0 opacity-[0.4]" />
        <div className="relative px-4 py-2.5 text-center">
          <p className="text-sm font-semibold text-foreground/95">
            Three friends walk down a street, each with an iPhone voice agent.{" "}
            <span className="text-primary">“Count to {target} together.”</span>
          </p>
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            They didn’t fail for lack of intelligence. They failed for lack of{" "}
            <span className="font-semibold text-warning">shared state</span>. The fix isn’t better agents — it’s a shared room.
          </p>
        </div>
      </div>

      {/* Progress */}
      <div className="shrink-0 border-b border-border bg-card/50 px-4 py-2">
        <div className="flex items-center gap-3">
          <span className="flex shrink-0 items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            <Zap className="size-3 text-success" />
            Shared-room progress
          </span>
          <div className="relative h-2.5 flex-1 overflow-hidden rounded-full bg-muted/60 ring-1 ring-inset ring-border">
            <div
              className="h-full rounded-full bg-gradient-to-r from-success/70 to-success shadow-[0_0_12px_hsl(var(--success)/0.7)] transition-all duration-300 ease-out"
              style={{ width: `${progressPct}%` }}
            />
          </div>
          <span
            className={cn(
              "shrink-0 text-right font-mono text-sm font-bold tabular-nums",
              done ? "text-success" : "text-foreground",
            )}
          >
            {progressNum}
            <span className="text-muted-foreground">/{target}</span>
          </span>
          {done && (
            <Badge variant="success" dot>
              complete
            </Badge>
          )}
        </div>
      </div>

      {/* Architecture note */}
      <details className="group shrink-0 border-b border-border bg-primary/[0.04]">
        <summary className="flex cursor-pointer list-none items-center gap-2 px-4 py-1.5 text-[11px] text-primary/90 transition-colors hover:bg-primary/[0.07]">
          <Info className="size-3.5 shrink-0" />
          <span className="font-semibold text-primary">Real-world architecture</span>
          <span className="text-muted-foreground">— how three iPhones share one authoritative room</span>
          <ArrowRight className="ml-auto size-3.5 shrink-0 text-muted-foreground transition-transform group-open:rotate-90" />
        </summary>
        <p className="px-4 pb-2.5 pl-9 text-[11px] leading-relaxed text-muted-foreground">
          Each iPhone runs its own voice agent, but all three join the same live room (WebSocket / LiveKit / backend).
          The room state is authoritative and lives on a shared server. Each agent reads the room, emits only task
          actions, and the scheduler hands the floor to the next speaker. The demo below simulates that room on the server.
        </p>
      </details>

      {/* Panels */}
      <div className="flex flex-1 overflow-hidden">
        <ComparePanel
          tone="bad"
          icon={<Repeat className="size-4" />}
          title="No shared state"
          subtitle="3 iPhones · transcripts only"
          badge={<Badge variant="destructive" dot>loop</Badge>}
          caption="Each iPhone only hears the audio transcript. No floor control, no counter, no scheduler."
          footer={deriveBadFooter(badSteps)}
          steps={revealedBad}
          total={badSteps.length}
          streaming={streaming}
          currentStepIndex={currentStepIndex}
          provenance={provenance?.bad}
          dock={<AgentPrivateStatePanel steps={badSteps} currentIndex={currentStepIndex} />}
        />
        <ComparePanel
          tone="good"
          icon={<Server className="size-4" />}
          title="One shared room"
          subtitle="3 iPhones + authoritative room state"
          badge={<Badge variant="success" dot>task advances</Badge>}
          caption="One room state: floor owner, counter, next speaker, required act. The scheduler suppresses acknowledgements."
          footer={`3 iPhones + 1 shared room + scheduler = count to ${target}`}
          steps={revealedGood}
          total={goodSteps.length}
          streaming={streaming}
          currentStepIndex={currentStepIndex}
          provenance={provenance?.good}
          dock={<RoomStatePanel steps={goodSteps} currentIndex={currentStepIndex} target={target} />}
        />
      </div>
    </div>
  );
}

function ComparePanel({
  tone,
  icon,
  title,
  subtitle,
  badge,
  caption,
  footer,
  steps,
  total,
  streaming,
  currentStepIndex,
  provenance,
  dock,
}: {
  tone: "bad" | "good";
  icon: React.ReactNode;
  title: string;
  subtitle: string;
  badge: React.ReactNode;
  caption: string;
  footer: string;
  steps: CompareStep[];
  total: number;
  streaming: boolean;
  currentStepIndex: number;
  provenance?: string;
  dock?: React.ReactNode;
}) {
  const bad = tone === "bad";
  const isStreaming = streaming && steps.length < total;
  return (
    <section
      className={cn(
        "relative flex flex-1 flex-col overflow-hidden",
        bad ? "border-r border-destructive/20 bg-destructive/[0.03]" : "bg-success/[0.03]",
      )}
    >
      {/* header */}
      <div
        className={cn(
          "flex shrink-0 items-center gap-2.5 border-b px-4 py-2.5",
          bad ? "border-destructive/20 bg-destructive/[0.06]" : "border-success/20 bg-success/[0.06]",
        )}
      >
        <div
          className={cn(
            "flex size-8 shrink-0 items-center justify-center rounded-lg border",
            bad ? "border-destructive/30 bg-destructive/10 text-destructive" : "border-success/30 bg-success/10 text-success",
          )}
        >
          {icon}
        </div>
        <div className="min-w-0 leading-tight">
          <h2 className={cn("truncate text-sm font-bold", bad ? "text-destructive" : "text-success")}>{title}</h2>
          <p className="truncate text-[11px] text-muted-foreground">{subtitle}</p>
        </div>
        <div className="ml-auto flex shrink-0 items-center gap-2">
          {isStreaming && (
            <span
              className={cn(
                "hidden items-center gap-1 rounded-full border px-1.5 py-0.5 font-mono text-[10px] font-semibold tabular-nums sm:inline-flex",
                bad ? "border-destructive/40 text-destructive" : "border-success/40 text-success",
              )}
            >
              <span className="size-1.5 animate-pulse rounded-full bg-current" />
              {steps.length}/{total}
            </span>
          )}
          {badge}
        </div>
      </div>

      {/* caption */}
      <p
        className={cn(
          "shrink-0 border-b px-4 py-1.5 text-[10px] leading-relaxed",
          bad ? "border-destructive/10 text-destructive" : "border-success/10 text-success",
        )}
      >
        {caption}
      </p>

      {/* trace */}
      <TraceTreeView
        spans={compareStepsToSpans(steps, tone)}
        accentColor={tone}
        className="border-0"
        activeIndex={currentStepIndex}
      />

      {dock && <div className="sticky bottom-0 z-10">{dock}</div>}

      {/* provenance — honest disclosure of what produced the utterance text */}
      {provenance && (
        <div
          className={cn(
            "flex shrink-0 items-center gap-1.5 border-t px-4 py-1 font-mono text-[9px]",
            bad
              ? "border-destructive/15 bg-destructive/[0.04] text-destructive/80"
              : "border-success/15 bg-success/[0.04] text-success/80",
          )}
        >
          <Cpu className="size-3 shrink-0" />
          <span className="truncate" title={provenance}>
            text source: {provenance}
          </span>
        </div>
      )}

      {/* footer */}
      <div
        className={cn(
          "flex shrink-0 items-center gap-1.5 border-t px-4 py-1.5 font-mono text-[10px] font-semibold",
          bad ? "border-destructive/20 bg-destructive/[0.06] text-destructive" : "border-success/20 bg-success/[0.06] text-success",
        )}
      >
        {bad ? <Repeat className="size-3" /> : <CircleCheck className="size-3" />}
        {footer}
      </div>
    </section>
  );
}

interface RoomStateValues {
  current: number | null;
  next: number | null;
  floorOwner: string | null;
  nextSpeaker: string | null;
  requiredAct: string | null;
  suppressAck: boolean;
}

function parseRoomState(summary: string): RoomStateValues {
  const currentMatch = summary.match(/current=(\d+)/);
  const nextMatch = summary.match(/next=(\d+)/);
  const scheduledMatch = summary.match(/scheduled=([\w-]+)/);
  return {
    current: currentMatch ? Number(currentMatch[1]) : null,
    next: nextMatch ? Number(nextMatch[1]) : null,
    floorOwner: scheduledMatch?.[1] ?? null,
    nextSpeaker: scheduledMatch?.[1] ?? null,
    requiredAct: "task_action",
    suppressAck: true,
  };
}

/* Minimal JSON syntax highlighter for the room-state inspector. */
function JsonLine({ line }: { line: string }) {
  const match = line.match(/^(\s*)([\w"]+):\s*(.*?)(,?)$/);
  if (!match) {
    return <div className="text-muted-foreground">{line}</div>;
  }
  const [, indent, key, value, comma] = match;
  const cleanKey = (key ?? "").replace(/"/g, "");
  const val = value ?? "";
  const valueClass = /^(true|false)$/.test(val)
    ? "text-warning"
    : /^-?\d+$/.test(val)
      ? "text-sky-300"
      : val === "{" || val === "null"
        ? "text-muted-foreground"
        : "text-emerald-300";
  return (
    <div>
      <span>{indent}</span>
      <span className="text-primary/90">{cleanKey}</span>
      {val && <span className="text-muted-foreground">: </span>}
      <span className={valueClass}>{val.replace(/"/g, "")}</span>
      <span className="text-muted-foreground">{comma}</span>
    </div>
  );
}

function RoomStatePanel({ steps, currentIndex, target }: { steps: CompareStep[]; currentIndex: number; target: number }) {
  const activeIndex = currentIndex >= 0 && currentIndex < steps.length ? currentIndex : steps.length - 1;
  const step = steps[activeIndex];
  const state = step ? parseRoomState(step.roomStateSummary) : null;
  const isLive = currentIndex >= 0 && currentIndex < steps.length;
  const isCompleted = state?.current != null && state.current >= target;

  if (!state) return null;

  const json = {
    task: { kind: "count_to_n", target, current: state.current, next: state.next, completed: isCompleted },
    floorOwner: state.floorOwner,
    nextSpeaker: state.nextSpeaker,
    nextRequiredAct: state.requiredAct,
    suppressAcknowledgements: state.suppressAck,
    loopRisk: false,
  };
  const lines = JSON.stringify(json, null, 2).split("\n");

  return (
    <div
      className={cn(
        "border-t bg-[hsl(223_30%_6%)]/95 px-3.5 py-2.5 font-mono backdrop-blur transition-colors",
        isLive ? "border-success/50" : "border-success/20",
      )}
    >
      <div className="mb-1.5 flex items-center gap-2">
        <ListTree className="size-3.5 text-success" />
        <span className="text-[11px] font-bold tracking-wide text-success">roomState</span>
        {isLive && (
          <span className="inline-flex items-center gap-1 text-[9px] font-semibold uppercase tracking-wider text-success/90">
            <span className="size-1.5 animate-pulse-soft rounded-full bg-success shadow-[0_0_6px_hsl(var(--success))]" />
            live
          </span>
        )}
        {isCompleted && (
          <span className="inline-flex items-center gap-1 text-[9px] font-bold uppercase tracking-wider text-success">
            <CircleCheck className="size-3" />
            completed
          </span>
        )}
        <span className="ml-auto text-[9px] text-muted-foreground">authoritative</span>
      </div>
      <pre className="overflow-x-auto text-[10.5px] leading-[1.5]">
        <code>
          {lines.map((line, i) => (
            <JsonLine key={i} line={line} />
          ))}
        </code>
      </pre>
    </div>
  );
}

/* Per-agent identity accents (matches trace badges + mini architecture). */
const PRIVATE_STATE_AGENT_COLORS: Record<string, string> = {
  "voice-a": "text-sky-300 border-sky-400/30 bg-sky-500/10",
  "voice-b": "text-violet-300 border-violet-400/30 bg-violet-500/10",
  "voice-c": "text-amber-300 border-amber-400/30 bg-amber-500/10",
};

/**
 * LEFT-panel mirror of the roomState inspector: three divergent private
 * states instead of one authoritative room. The punchline the video needs —
 * believesCurrent never advances while nextIntent oscillates between
 * acknowledge and wait-for-someone.
 */
function AgentPrivateStatePanel({ steps, currentIndex }: { steps: CompareStep[]; currentIndex: number }) {
  const activeIndex = currentIndex >= 0 && currentIndex < steps.length ? currentIndex : steps.length - 1;
  const step = steps[activeIndex];
  const states = step?.agentStates ?? [];
  const isLive = currentIndex >= 0 && currentIndex < steps.length;

  if (states.length === 0) return null;

  const maxBelief = Math.max(...states.map((s) => s.believesCurrent));
  const looping = maxBelief <= 1;

  return (
    <div
      className={cn(
        "border-t bg-[hsl(350_30%_6%)]/95 px-3.5 py-2.5 font-mono backdrop-blur transition-colors",
        isLive ? "border-destructive/50" : "border-destructive/20",
      )}
    >
      <div className="mb-1.5 flex items-center gap-2">
        <ListTree className="size-3.5 text-destructive" />
        <span className="text-[11px] font-bold tracking-wide text-destructive">3 private states — no shared truth</span>
        {isLive && (
          <span className="inline-flex items-center gap-1 text-[9px] font-semibold uppercase tracking-wider text-destructive/90">
            <span className="size-1.5 animate-pulse-soft rounded-full bg-destructive shadow-[0_0_6px_hsl(var(--destructive))]" />
            live
          </span>
        )}
        <span className="ml-auto text-[9px] text-muted-foreground">divergent · no authority</span>
      </div>
      <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-3">
        {states.map((s) => (
          <div key={s.agentId} className="rounded-md border border-destructive/20 bg-destructive/[0.05] px-2 py-1.5">
            <div className="mb-1 flex items-center gap-1.5">
              <span
                className={cn(
                  "rounded border px-1.5 py-0.5 text-[9px] font-semibold",
                  PRIVATE_STATE_AGENT_COLORS[s.agentId] ?? "text-muted-foreground border-border bg-muted",
                )}
              >
                {s.agentId}
              </span>
              <span className="text-[8px] uppercase tracking-wider text-muted-foreground">private</span>
            </div>
            <div className="space-y-0.5 text-[9.5px] leading-snug">
              <div>
                <span className="text-muted-foreground">believesCurrent: </span>
                <span className="font-bold text-rose-300">{s.believesCurrent}</span>
                {s.believesCurrent <= 1 && (
                  <span className="ml-1 text-[8px] font-semibold uppercase tracking-wider text-destructive/80">stuck</span>
                )}
              </div>
              <div>
                <span className="text-muted-foreground">nextIntent: </span>
                <span className={cn("font-semibold", s.nextIntent === "acknowledge" ? "text-warning" : "text-rose-200/90")}>
                  {s.nextIntent}
                </span>
              </div>
              <div>
                <span className="text-muted-foreground">lastClassifiedAs: </span>
                <span className="text-rose-200/80">{s.lastClassifiedAs}</span>
              </div>
              <div className="text-muted-foreground">
                heard <span className="text-rose-200/80">{s.heardCount}</span> · spoke{" "}
                <span className="text-rose-200/80">{s.spokeCount}</span>
              </div>
            </div>
          </div>
        ))}
      </div>
      <p className="mt-1.5 text-[9px] leading-relaxed text-destructive/70">
        {looping
          ? "Each agent privately believes current≤1 and flips between acknowledge ⇄ wait-for-someone. Nobody ever commits 2."
          : "Still three separate private beliefs — nothing here is authoritative or committed."}
      </p>
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────── */
/*  Empty / loading hero                                                */
/* ────────────────────────────────────────────────────────────────── */

function CompareHero({ running, onRun }: { running: boolean; onRun: () => void }) {
  return (
    <div className="relative flex flex-1 items-center justify-center overflow-y-auto px-6 py-10">
      <div className="bg-grid pointer-events-none absolute inset-0 opacity-[0.35] [mask-image:radial-gradient(60%_50%_at_50%_40%,black,transparent)]" />
      <div className="relative flex w-full max-w-2xl flex-col items-center text-center">
        <Badge variant="outline" className="mb-5 gap-1.5 px-3 py-1">
          <span className="size-1.5 rounded-full bg-success shadow-[0_0_6px_hsl(var(--success))]" />
          local-first · no API keys
        </Badge>

        <h2 className="text-balance text-2xl font-bold tracking-tight sm:text-3xl">
          Why multi-agent voice loops <span className="text-destructive">get stuck</span>
          <br className="hidden sm:block" /> — and how a{" "}
          <span className="bg-gradient-to-r from-primary to-success bg-clip-text text-transparent">
            shared room
          </span>{" "}
          fixes it
        </h2>
        <p className="mt-3 max-w-xl text-pretty text-sm leading-relaxed text-muted-foreground">
          Three voice agents try to count together. With transcripts alone they loop on “yeah, exactly…”
          forever. Give them one server-authoritative room state and they count all the way up.
        </p>

        {/* mini architecture */}
        <div className="mt-8 w-full">
          <MiniArchitecture />
        </div>

        <div className="mt-8 flex flex-col items-center gap-3">
          <Button size="lg" onClick={onRun} disabled={running} className="px-7">
            {running ? "Simulating room…" : "Run the comparison"}
            {!running && <ArrowRight className="size-4" />}
          </Button>
          <p className="text-[11px] text-muted-foreground">
            Runs the bad vs. good demo side-by-side and narrates the good run aloud.
          </p>
        </div>
      </div>
    </div>
  );
}

function MiniArchitecture() {
  const phones = [
    { id: "voice-a", color: "text-sky-300 border-sky-400/30 bg-sky-500/10" },
    { id: "voice-b", color: "text-violet-300 border-violet-400/30 bg-violet-500/10" },
    { id: "voice-c", color: "text-amber-300 border-amber-400/30 bg-amber-500/10" },
  ];
  return (
    <div className="flex items-center justify-center gap-3 rounded-xl border border-border bg-card/60 px-4 py-4 shadow-panel sm:gap-5">
      <div className="flex flex-col gap-1.5">
        {phones.map((p) => (
          <div
            key={p.id}
            className={cn("flex items-center gap-1.5 rounded-md border px-2 py-1 font-mono text-[10px] font-semibold", p.color)}
          >
            <Smartphone className="size-3" />
            {p.id}
          </div>
        ))}
      </div>

      <ArrowRight className="size-4 shrink-0 text-muted-foreground" />

      <div className="flex flex-col items-center gap-1.5 rounded-lg border border-primary/40 bg-primary/10 px-4 py-3 shadow-[0_0_24px_-8px_hsl(var(--primary)/0.7)]">
        <Boxes className="size-5 text-primary" />
        <span className="text-[11px] font-bold text-primary">Shared Room</span>
        <span className="text-[9px] text-muted-foreground">authoritative state</span>
      </div>

      <ArrowRight className="size-4 shrink-0 text-muted-foreground" />

      <div className="flex flex-col gap-1.5">
        {["roomState", "scheduler", "classifier"].map((m) => (
          <div
            key={m}
            className="rounded-md border border-border-strong bg-elevated/70 px-2 py-1 font-mono text-[10px] font-medium text-muted-foreground"
          >
            {m}
          </div>
        ))}
      </div>
    </div>
  );
}
