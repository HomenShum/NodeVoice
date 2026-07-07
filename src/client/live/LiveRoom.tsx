import * as React from "react";
import {
  Radio,
  QrCode,
  Mic,
  StepForward,
  Play,
  Pause,
  Volume2,
  VolumeX,
  Cpu,
  ChevronDown,
  Send,
  Sparkles,
  ArrowRight,
  Link as LinkIcon,
  ListTree,
  Loader,
  Lock,
  Globe,
  Share2,
  Check,
  Plus,
  Minus,
  RotateCcw,
  XCircle,
  ShieldCheck,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Qr } from "./Qr";
import {
  useRoom,
  useActiveRooms,
  LIVE_BASE,
  CONVEX_MODE,
  MAX_AGENT_COUNT,
  activeSlots,
  agentIndexFromSlot,
  isAgentSlot,
  type CapabilityProfileId,
  type Slot,
  type MySlot,
  type RoomUtterance,
  type PublicRoom,
  type TraceEvent,
  type AgentOsPolicy,
} from "./roomClient";

const DEFAULT_GOAL =
  "Plan a great Saturday for two friends in San Francisco and agree on a final 3-stop itinerary with rough timing.";
const VISIBLE_UTTERANCE_LIMIT = 160;
const WEB_RESEARCH_MODEL_ID = "gpt-4.1-mini";

const PROFILE_OPTIONS: Array<{
  id: CapabilityProfileId;
  label: string;
  short: string;
  note: string;
  coordination: string;
  steering: string;
  liveEffect: string;
}> = [
  {
    id: "v0_no_room_state",
    label: "V0 Failure",
    short: "V0",
    note: "raw transcript",
    coordination: "No room counter",
    steering: "Steer stays transcript-only",
    liveEffect: "Good for reproducing overlap and stalls",
  },
  {
    id: "v1_room_state",
    label: "V1 Room State",
    short: "V1",
    note: "shared reducer",
    coordination: "Floor + count state",
    steering: "Goal changes are durable",
    liveEffect: "Best default for phone/laptop tests",
  },
  {
    id: "v2_work_room",
    label: "V2 Work Room",
    short: "V2",
    note: "intent router",
    coordination: "Reducer + typed intent",
    steering: "LLM interprets interrupts",
    liveEffect: "Use for retargeting mid-conversation",
  },
  {
    id: "v3_agent_ecosystem",
    label: "V3 Agent OS",
    short: "V3",
    note: "goal graph",
    coordination: "Goals + workers + artifacts",
    steering: "Adds workstreams by default",
    liveEffect: "Parallel background execution",
  },
];

function profileMeta(profile?: string) {
  return PROFILE_OPTIONS.find((p) => p.id === profile) ?? PROFILE_OPTIONS[1]!;
}

function listNames(names: string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names.slice(0, -1).join(", ")}, and ${names[names.length - 1]}`;
}

function compactNameList(names: string[]): string {
  if (names.length <= 4) return listNames(names);
  return `${names.slice(0, 3).join(", ")}, and ${names.length - 3} more`;
}

function formatExpectedCost(value?: number): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "n/a";
  if (value <= 0) return "$0";
  if (value < 0.01) return `$${value.toFixed(6).replace(/0+$/, "").replace(/\.$/, "")}`;
  return `$${value.toFixed(2)}`;
}

function formatDurationMs(value?: number): string {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return "n/a";
  if (value < 1000) return `${Math.round(value)}ms`;
  if (value < 10_000) return `${(value / 1000).toFixed(1)}s`;
  return `${Math.round(value / 1000)}s`;
}

function workerRuntimeMs(worker: { startedAt?: number; completedAt?: number; updatedAt: number; status: string }): number | null {
  if (typeof worker.startedAt !== "number") return null;
  const end = typeof worker.completedAt === "number" ? worker.completedAt : worker.status === "running" ? Date.now() : worker.updatedAt;
  return Math.max(0, end - worker.startedAt);
}

function average(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

const COLOR_STYLE: Record<string, string> = {
  sky: "text-sky-300 bg-sky-500/10 border-sky-400/30",
  violet: "text-violet-300 bg-violet-500/10 border-violet-400/30",
  emerald: "text-emerald-300 bg-emerald-500/10 border-emerald-400/30",
  amber: "text-amber-300 bg-amber-500/10 border-amber-400/30",
  rose: "text-rose-300 bg-rose-500/10 border-rose-400/30",
  cyan: "text-cyan-300 bg-cyan-500/10 border-cyan-400/30",
  lime: "text-lime-300 bg-lime-500/10 border-lime-400/30",
  pink: "text-pink-300 bg-pink-500/10 border-pink-400/30",
  orange: "text-orange-300 bg-orange-500/10 border-orange-400/30",
  indigo: "text-indigo-300 bg-indigo-500/10 border-indigo-400/30",
  human: "text-primary bg-primary/10 border-primary/30",
  system: "text-muted-foreground bg-muted border-border",
};

/** Stronger fill for circular avatar badges — COLOR_STYLE's 10% tint reads as
 *  near-invisible at avatar size, so avatars get their own saturated variant. */
const AVATAR_STYLE: Record<string, string> = {
  sky: "bg-sky-500/25 text-sky-100 ring-sky-400/40",
  violet: "bg-violet-500/25 text-violet-100 ring-violet-400/40",
  emerald: "bg-emerald-500/25 text-emerald-100 ring-emerald-400/40",
  amber: "bg-amber-500/25 text-amber-100 ring-amber-400/40",
  rose: "bg-rose-500/25 text-rose-100 ring-rose-400/40",
  cyan: "bg-cyan-500/25 text-cyan-100 ring-cyan-400/40",
  lime: "bg-lime-500/25 text-lime-100 ring-lime-400/40",
  pink: "bg-pink-500/25 text-pink-100 ring-pink-400/40",
  orange: "bg-orange-500/25 text-orange-100 ring-orange-400/40",
  indigo: "bg-indigo-500/25 text-indigo-100 ring-indigo-400/40",
  human: "bg-primary/25 text-primary-foreground ring-primary/50",
  system: "bg-muted text-muted-foreground ring-border",
};

function slotColorName(slot: string, room?: PublicRoom): string {
  if (slot === "human") return "human";
  if (slot === "system" || slot === "spectator") return "system";
  const color = room?.agents[slot]?.color;
  if (color && COLOR_STYLE[color]) return color;
  const idx = agentIndexFromSlot(slot) ?? 1;
  const palette = ["sky", "violet", "emerald", "amber", "rose", "cyan", "lime", "pink", "orange", "indigo"];
  return palette[(idx - 1) % palette.length]!;
}

function slotStyle(slot: string, room?: PublicRoom): string {
  return COLOR_STYLE[slotColorName(slot, room)] ?? COLOR_STYLE.system!;
}

function avatarStyle(slot: string, room?: PublicRoom): string {
  return AVATAR_STYLE[slotColorName(slot, room)] ?? AVATAR_STYLE.system!;
}

/** Avatar initial: agent display name's first letter, or '?' if unnamed. */
function avatarInitial(name: string): string {
  const trimmed = name.trim();
  return trimmed ? trimmed[0]!.toUpperCase() : "?";
}

function fallbackAgentName(slot: string): string {
  const idx = agentIndexFromSlot(slot);
  return idx ? `Agent ${idx}` : slot;
}

export default function LiveRoom() {
  const rm = useRoom();
  const params = React.useMemo(() => new URLSearchParams(window.location.search), []);
  // joinable via QR deep-link (?room=…) OR an in-app pick (active list / code)
  const [pendingJoin, setPendingJoin] = React.useState<string | null>(null);
  const joinId = params.get("room") ?? pendingJoin;

  if (rm.room) {
    return <InRoom rm={rm} />;
  }
  if (joinId) {
    return <JoinGate rm={rm} roomId={joinId} onJoined={() => setPendingJoin(null)} />;
  }
  return <Lobby rm={rm} onJoinRoom={setPendingJoin} />;
}

/* ── shell ─────────────────────────────────────────────────────────── */
function Shell({ children, locked = false }: { children: React.ReactNode; locked?: boolean }) {
  return (
    <div className={cn("relative flex flex-col bg-background text-foreground", locked ? "h-dvh overflow-hidden" : "min-h-screen")}>
      <div className="bg-grid pointer-events-none fixed inset-0 opacity-[0.25] [mask-image:radial-gradient(70%_60%_at_50%_0%,black,transparent)]" />
      <div className={cn("relative flex flex-1 flex-col", locked && "min-h-0 overflow-hidden")}>{children}</div>
    </div>
  );
}

function Brand({ tag }: { tag: string }) {
  return (
    <div className="flex items-center gap-2.5">
      <div className="flex size-8 items-center justify-center rounded-lg bg-gradient-to-br from-primary to-primary/70 shadow-[0_4px_16px_-4px_hsl(var(--primary)/0.8)]">
        <Radio className="size-4.5 text-primary-foreground" strokeWidth={2.25} />
      </div>
      <div className="leading-tight">
        <h1 className="text-sm font-bold tracking-tight">Room OS · Live</h1>
        <p className="text-[10px] text-muted-foreground">{tag}</p>
      </div>
    </div>
  );
}

/* ── lobby (create) ────────────────────────────────────────────────── */
function Lobby({ rm, onJoinRoom }: { rm: ReturnType<typeof useRoom>; onJoinRoom: (id: string) => void }) {
  const [goal, setGoal] = React.useState(DEFAULT_GOAL);
  const [busy, setBusy] = React.useState(false);
  const [isPrivate, setIsPrivate] = React.useState(false);
  const [profile, setProfile] = React.useState<CapabilityProfileId>("v1_room_state");
  const [agentCount, setAgentCount] = React.useState(2);
  const [joinCode, setJoinCode] = React.useState("");
  const [joinBusy, setJoinBusy] = React.useState(false);
  const [joinError, setJoinError] = React.useState<string | null>(null);
  const activeRooms = useActiveRooms();

  async function create() {
    setBusy(true);
    rm.unlockAudio();
    await rm.createRoom(goal.trim() || DEFAULT_GOAL, undefined, isPrivate, profile, agentCount);
    setBusy(false);
  }

  async function joinByCode() {
    const code = joinCode.trim().toLowerCase();
    if (!code) return;
    setJoinBusy(true);
    setJoinError(null);
    const id = await rm.resolveCode(code);
    setJoinBusy(false);
    if (id) onJoinRoom(id);
    else setJoinError(`No active room with code "${code}".`);
  }

  return (
    <Shell>
      <div className="flex flex-1 items-center justify-center px-6 py-12">
        <div className="w-full max-w-xl">
          <div className="mb-6 flex justify-center">
            <Brand tag={`${agentCount} agents · one shared room · live voice`} />
          </div>
          <Badge variant="outline" className="mb-4 gap-1.5">
            <span className="size-1.5 rounded-full bg-success shadow-[0_0_6px_hsl(var(--success))]" />
            local-first · your keys, server-side
          </Badge>
          <h2 className="text-balance text-2xl font-bold tracking-tight sm:text-3xl">
            Start a live room. Voice <span className="text-primary">agents</span> actually talk it out.
          </h2>
          <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
            This device becomes <span className="font-semibold text-sky-300">Ada</span>. Add phones or tabs for more agent voices in the same shared room, then jump in by voice anytime.
          </p>

          <label className="mt-6 block text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Shared goal</label>
          <textarea
            value={goal}
            onChange={(e) => setGoal(e.target.value)}
            rows={3}
            className="mt-1.5 w-full resize-none rounded-lg border border-border bg-input/70 px-3.5 py-2.5 text-sm text-foreground outline-none transition-colors placeholder:text-muted-foreground focus-visible:border-primary/60 focus-visible:ring-2 focus-visible:ring-ring/40"
            placeholder="What should the agents work on together?"
          />

          <div className="mt-3 grid grid-cols-4 gap-1.5 rounded-xl border border-border bg-elevated/40 p-1.5">
            {PROFILE_OPTIONS.map((p) => {
              const active = profile === p.id;
              return (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => setProfile(p.id)}
                  className={cn(
                    "min-w-0 rounded-lg border px-2 py-2 text-left transition-all",
                    active
                      ? "border-primary/40 bg-primary text-primary-foreground shadow-[0_4px_16px_-6px_hsl(var(--primary)/0.6)]"
                      : "border-transparent text-muted-foreground hover:border-border-strong hover:bg-muted hover:text-foreground",
                  )}
                  title={`${p.label}: ${p.note}`}
                >
                  <span className="flex items-center gap-1 text-xs font-bold">
                    <span className={cn("size-1.5 rounded-full", active ? "bg-primary-foreground" : "bg-muted-foreground/50")} />
                    {p.short}
                  </span>
                  <span className="block truncate text-[10px] opacity-85">{p.note}</span>
                </button>
              );
            })}
          </div>

          <div className="mt-3 flex items-center gap-2 rounded-xl border border-border bg-elevated/40 p-2">
            <span className="min-w-0 flex-1">
              <span className="block text-xs font-bold text-foreground">Starting roster</span>
              <span className="block text-[10px] text-muted-foreground">Joiners get their own agent; host can grow to {MAX_AGENT_COUNT}.</span>
            </span>
            <Button variant="outline" size="icon" onClick={() => setAgentCount((v) => Math.max(1, v - 1))} disabled={agentCount <= 1} title="One fewer starting agent">
              <Minus className="size-4" />
            </Button>
            <input
              type="number"
              min={1}
              max={MAX_AGENT_COUNT}
              value={agentCount}
              onChange={(e) => setAgentCount(Math.max(1, Math.min(MAX_AGENT_COUNT, Number(e.target.value) || 1)))}
              className="h-9 w-16 rounded-md border border-border bg-input/70 text-center font-mono text-sm font-semibold text-foreground outline-none focus-visible:border-primary/60 focus-visible:ring-2 focus-visible:ring-ring/40"
              aria-label="Starting agent count"
            />
            <Button variant="outline" size="icon" onClick={() => setAgentCount((v) => Math.min(MAX_AGENT_COUNT, v + 1))} disabled={agentCount >= MAX_AGENT_COUNT} title="One more starting agent">
              <Plus className="size-4" />
            </Button>
          </div>

          {/* visibility: public rooms appear in the lobby list; private are link/code-only */}
          <button
            type="button"
            role="switch"
            aria-checked={isPrivate}
            onClick={() => setIsPrivate((v) => !v)}
            className={cn(
              "mt-3 flex w-full items-center gap-2.5 rounded-lg border px-3 py-2 text-left text-xs transition-colors",
              isPrivate ? "border-warning/40 bg-warning/[0.06]" : "border-border bg-elevated/50 hover:border-border-strong",
            )}
          >
            {isPrivate ? <Lock className="size-4 shrink-0 text-warning" /> : <Globe className="size-4 shrink-0 text-muted-foreground" />}
            <span className="min-w-0 flex-1">
              <span className={cn("block font-semibold", isPrivate ? "text-warning" : "text-foreground")}>
                {isPrivate ? "Private room" : "Public room"}
              </span>
              <span className="block text-muted-foreground">
                {isPrivate
                  ? "Unlisted — people join only via your shared link, QR, or code."
                  : "Listed in the lobby so anyone here can hop in."}
              </span>
            </span>
            <span className={cn("relative h-4 w-7 shrink-0 rounded-full transition-colors", isPrivate ? "bg-warning" : "bg-muted")}>
              <span className={cn("absolute top-0.5 size-3 rounded-full bg-white shadow transition-all", isPrivate ? "left-3.5" : "left-0.5")} />
            </span>
          </button>

          <div className="mt-5 flex items-center gap-3">
            <Button size="lg" onClick={create} disabled={busy} className="px-7">
              {busy ? <Loader className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
              {busy ? "Creating…" : "Create room"}
            </Button>
            {/* the compare demo needs the local Node server (/compare, /api/models) */}
            {!CONVEX_MODE && (
              <a href="/demo" className="text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline">
                or watch the bad-vs-good demo →
              </a>
            )}
          </div>
          {rm.error && <p className="mt-3 text-xs text-destructive">{rm.error}</p>}

          {/* ── join an existing room ─────────────────────────────── */}
          <div className="mt-8 rounded-xl border border-border bg-card/60 p-4 shadow-panel">
            <h3 className="flex items-center gap-2 text-sm font-bold">
              <QrCode className="size-4 text-primary" />
              Join a room
            </h3>
            <p className="mt-1 text-xs text-muted-foreground">
              Scan the QR on the host device — or type its room code:
            </p>
            <div className="mt-2.5 flex items-center gap-2">
              <input
                value={joinCode}
                onChange={(e) => setJoinCode(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void joinByCode();
                }}
                placeholder="e.g. x7k2mp"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                className="h-10 w-36 rounded-md border border-border bg-input/70 px-3 font-mono text-sm tracking-widest text-foreground outline-none placeholder:text-muted-foreground focus-visible:border-primary/60 focus-visible:ring-2 focus-visible:ring-ring/40"
              />
              <Button variant="outline" onClick={() => void joinByCode()} disabled={joinBusy || !joinCode.trim()}>
                {joinBusy ? <Loader className="size-4 animate-spin" /> : <ArrowRight className="size-4" />}
                Join
              </Button>
            </div>
            {joinError && <p className="mt-2 text-xs text-destructive">{joinError}</p>}

            {activeRooms.length > 0 && (
              <div className="mt-4">
                <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                  Active rooms · tap to join
                </p>
                <div className="mt-1.5 flex flex-col gap-1.5">
                  {activeRooms.map((r) => (
                    <button
                      key={r.id}
                      onClick={() => onJoinRoom(r.id)}
                      className="flex items-center gap-2.5 rounded-lg border border-border bg-elevated/50 px-3 py-2 text-left transition-all hover:border-primary/40 hover:shadow-[0_4px_16px_-8px_hsl(var(--primary)/0.5)]"
                    >
                      <span className="shrink-0 rounded-md bg-primary/10 px-1.5 py-0.5 font-mono text-[11px] font-bold text-primary ring-1 ring-inset ring-primary/20">
                        {r.code ?? r.id.slice(0, 6)}
                      </span>
                      <span className="min-w-0 flex-1 truncate text-xs text-foreground/85">{r.goal}</span>
                      <Badge variant="outline" className="shrink-0 font-mono text-[10px]">
                        {profileMeta(r.profile).short}
                      </Badge>
                      <span className="shrink-0 font-mono text-[10px] text-muted-foreground">{r.agentCount ?? 2} agents</span>
                      <span className="shrink-0 font-mono text-[10px] text-muted-foreground">turn {r.turn}</span>
                      {r.done ? (
                        <Badge variant="success" dot>agreed</Badge>
                      ) : r.running ? (
                        <Badge variant="default" dot>talking</Badge>
                      ) : (
                        <Badge variant="outline">idle</Badge>
                      )}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </Shell>
  );
}

/* ── join gate (phone via QR) ──────────────────────────────────────── */
function JoinGate({ rm, roomId, onJoined }: { rm: ReturnType<typeof useRoom>; roomId: string; onJoined: () => void }) {
  const [slot, setSlot] = React.useState<MySlot | "auto">("auto");
  const [busy, setBusy] = React.useState(false);

  async function join() {
    setBusy(true);
    rm.unlockAudio(); // this click is the iOS audio-unlock gesture
    const ok = await rm.joinRoom(roomId, slot);
    setBusy(false);
    if (ok) onJoined();
  }

  return (
    <Shell>
      <div className="flex flex-1 items-center justify-center px-6 py-12">
        <div className="w-full max-w-sm text-center">
          <div className="mb-6 flex justify-center">
            <Brand tag={`joining room ${roomId}`} />
          </div>
          <h2 className="text-xl font-bold">Join the room</h2>
          <p className="mt-2 text-sm text-muted-foreground">Join with your own agent voice, or watch silently.</p>

          <div className="mt-5 grid grid-cols-2 gap-2">
            {([
              { k: "auto" as const, label: "My agent", sub: "auto-assigned", cls: COLOR_STYLE.sky },
              { k: "spectator" as MySlot, label: "Watch", sub: "listen only", cls: COLOR_STYLE.system },
            ] as const).map((o) => (
              <button
                key={o.k}
                onClick={() => setSlot(o.k)}
                className={cn(
                  "rounded-lg border px-2 py-3 text-xs font-semibold transition-all",
                  slot === o.k ? o.cls + " ring-2 ring-current/40" : "border-border bg-elevated/60 text-muted-foreground hover:text-foreground",
                )}
              >
                {o.label}
                <span className="mt-0.5 block text-[10px] font-normal opacity-80">{o.sub}</span>
              </button>
            ))}
          </div>

          <Button size="lg" onClick={join} disabled={busy} className="mt-6 w-full">
            {busy ? <Loader className="size-4 animate-spin" /> : <Volume2 className="size-4" />}
            {busy ? "Joining…" : "Join & enable sound"}
          </Button>
          <p className="mt-2 text-[11px] text-muted-foreground">Enabling sound is required so the agent can speak on this phone.</p>
          {rm.error && <p className="mt-3 text-xs text-destructive">{rm.error}</p>}
        </div>
      </div>
    </Shell>
  );
}

/* ── in-room ───────────────────────────────────────────────────────── */
function InRoom({ rm }: { rm: ReturnType<typeof useRoom> }) {
  const room = rm.room!;
  const joinUrl = `${window.location.origin}/?room=${room.id}`;
  const [steer, setSteer] = React.useState("");
  const [showQr, setShowQr] = React.useState(true);
  const [showTraces, setShowTraces] = React.useState(false);
  const scrollRef = React.useRef<HTMLDivElement>(null);
  const agentSlots = activeSlots(room.state.agentCount);
  const connectedAgentSlots = new Set(room.participants.map((p) => p.slot).filter(isAgentSlot));
  const hasRemoteAgent = [...connectedAgentSlots].some((slot) => agentIndexFromSlot(slot) !== 1);
  const waitingForAgent = agentIndexFromSlot(rm.mySlot) === 1 && connectedAgentSlots.size < agentSlots.length;
  const currentProfile = profileMeta(room.state.profile);
  const visibleUtterances = room.utterances.slice(-VISIBLE_UTTERANCE_LIMIT);
  const hiddenUtteranceCount = Math.max(0, room.utterances.length - visibleUtterances.length);

  React.useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [room.utterances.length]);

  const meName = isAgentSlot(rm.mySlot) ? room.agents[rm.mySlot]?.name ?? fallbackAgentName(rm.mySlot) : "spectator";
  const agentNames = agentSlots.map((slot) => room.agents[slot]?.name ?? fallbackAgentName(slot));
  const connectedLabel = hasRemoteAgent
    ? `${connectedAgentSlots.size}/${agentSlots.length} agent devices connected`
    : `waiting for another device`;

  return (
    <Shell locked>
      {/* top bar */}
      <header className="z-20 flex shrink-0 items-center gap-3 border-b border-border bg-card/85 px-4 py-2.5 backdrop-blur">
        <Brand tag={`room ${room.code ?? room.id} · ${connectedLabel}`} />
        <div className="ml-auto flex items-center gap-2">
          <span
            className={cn(
              "inline-flex items-center gap-1.5 rounded-full border px-2 py-1 text-[11px] font-medium",
              rm.connected ? "border-success/40 text-success" : "border-border text-muted-foreground",
            )}
          >
            <span className={cn("size-1.5 rounded-full", rm.connected ? "bg-success animate-pulse" : "bg-muted-foreground")} />
            {rm.connected ? "live" : "connecting…"}
          </span>
          <span className={cn("rounded-full border px-2 py-1 text-[11px] font-semibold", slotStyle(rm.mySlot, room))}>
            you: {meName}
          </span>
          <Button
            variant={showTraces ? "secondary" : "outline"}
            size="xs"
            onClick={() => setShowTraces((v) => !v)}
            title="Internal State — live reducer snapshot plus trace payloads"
          >
            <ListTree className="size-3.5" /> State
          </Button>
          <Button variant="outline" size="xs" onClick={() => setShowQr((v) => !v)}>
            <QrCode className="size-3.5" /> Invite
          </Button>
        </div>
      </header>

      {/* goal + progress */}
      <div className="shrink-0 border-b border-border bg-card/40 px-4 py-2">
        <div className="flex items-center gap-2 text-sm">
          <Sparkles className="size-3.5 shrink-0 text-primary" />
          <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Goal</span>
          <span className="min-w-0 flex-1 truncate text-foreground/90">{room.state.goal}</span>
          {/* provenance: this room is genuinely model-generated, never scripted */}
          <Badge variant="outline" className="hidden shrink-0 font-mono text-[10px] normal-case sm:inline-flex" title="Every utterance is generated live by this model — nothing is scripted.">
            openai · {room.state.model} · {currentProfile.short}
          </Badge>
          <span className="shrink-0 font-mono text-[11px] text-muted-foreground">turn {room.state.turn}</span>
          {room.state.done && <Badge variant="success" dot>agreed</Badge>}
          {room.state.loopRisk && !room.state.done && <Badge variant="warning" dot>loop risk</Badge>}
        </div>
      </div>

      <LiveVersionPanel room={room} onChange={rm.setProfile} onAgentCountChange={rm.setAgentCount} />

      {(room.state.profile === "v3_agent_ecosystem" || (room.goals?.length ?? 0) > 0 || (room.workers?.length ?? 0) > 0) && (
        <V3WorkPanel room={room} onCancelWorker={rm.cancelV3Worker} onRetryWorker={rm.retryV3Worker} onPolicyChange={rm.setV3Policy} />
      )}

      {showQr && waitingForAgent && (
        <div className="flex shrink-0 flex-col items-center gap-3 border-b border-border bg-primary/[0.04] px-4 py-4 sm:flex-row sm:justify-center">
          <Qr value={joinUrl} size={132} />
          <div className="max-w-xl text-center sm:text-left">
            <p className="flex items-center justify-center gap-2 text-sm font-semibold sm:justify-start">
              Scan from your phone to join another agent
              {room.private && (
                <Badge variant="warning" className="gap-1">
                  <Lock className="size-3" /> private
                </Badge>
              )}
            </p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {room.private
                ? "Unlisted room — only people with this link, QR, or code can join."
                : "Devices join the same room. Keep them near each other to hear the conversation."}
            </p>
            {room.code && (
              <p className="mt-2 text-xs text-muted-foreground">
                No camera? Open the site and type code{" "}
                <span className="rounded bg-primary/10 px-1.5 py-0.5 font-mono text-sm font-bold tracking-widest text-primary">{room.code}</span>{" "}
                under “Join a room”.
              </p>
            )}
            <div className="mt-2 flex flex-wrap items-center justify-center gap-2 sm:justify-start">
              <ShareInvite joinUrl={joinUrl} code={room.code} />
              <code className="max-w-[20rem] truncate rounded bg-elevated px-1.5 py-0.5 text-[11px] text-primary">{joinUrl}</code>
            </div>
          </div>
        </div>
      )}

      {/* transcript */}
      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-4">
        <div className="mx-auto flex max-w-3xl flex-col gap-2.5">
          {hiddenUtteranceCount > 0 && (
            <div className="py-1 text-center text-[11px] text-muted-foreground">
              Showing latest {visibleUtterances.length} of {room.utterances.length} room entries.
            </div>
          )}
          {room.utterances.length === 0 && (
            <div className="mt-10 text-center text-sm text-muted-foreground">
              Press <span className="font-semibold text-foreground">Start</span> to let {compactNameList(agentNames)} begin — or hold the mic to speak first.
            </div>
          )}
          {visibleUtterances.map((u) => (
            <UtteranceRow key={u.id} u={u} room={room} isFloor={u.slot === room.state.floorOwner} />
          ))}
        </div>
      </div>

      {/* trace inspector — the proof layer */}
      {showTraces && <StateInspector room={room} />}

      {/* controls */}
      <div className="shrink-0 border-t border-border bg-card/85 px-4 py-3 backdrop-blur">
        <div className="mx-auto flex max-w-3xl items-center gap-2 rounded-2xl border border-border bg-background/85 p-2 shadow-panel">
          {room.state.running ? (
            <Button variant="outline" size="default" onClick={() => rm.setRunning(false)}>
              <Pause className="size-4" /> Pause
            </Button>
          ) : (
            <Button size="default" onClick={() => rm.setRunning(true)} disabled={room.state.done}>
              <Play className="size-4 fill-current" /> {room.state.turn === 0 ? "Start" : "Resume"}
            </Button>
          )}
          <input
            value={steer}
            onChange={(e) => setSteer(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && steer.trim()) {
                rm.sendText(steer);
                setSteer("");
              }
            }}
            placeholder="Message or steer the agents"
            className="h-10 min-w-0 flex-1 bg-transparent px-2 text-sm text-foreground outline-none placeholder:text-muted-foreground"
          />

          <button
            onPointerDown={(e) => {
              e.preventDefault();
              void rm.beginTalk();
            }}
            onPointerUp={rm.endTalk}
            onPointerLeave={() => rm.recording && rm.endTalk()}
            className={cn(
              "inline-flex size-10 shrink-0 select-none items-center justify-center rounded-full text-sm font-medium transition-all",
              rm.recording
                ? "bg-destructive text-destructive-foreground shadow-[0_0_0_4px_hsl(var(--destructive)/0.25)]"
                : "border border-border-strong bg-elevated/60 text-foreground hover:border-primary/40",
            )}
            title="Hold to talk"
            aria-label={rm.recording ? "Release to send voice steer" : "Hold to talk"}
          >
            <Mic className={cn("size-4", rm.recording && "animate-pulse")} />
            <span className="sr-only">{rm.recording ? "Listening, release to send" : "Hold to talk"}</span>
          </button>

          <Button
            variant="secondary"
            size="icon"
            onClick={() => {
              if (steer.trim()) {
                rm.sendText(steer);
                setSteer("");
              }
            }}
            disabled={!steer.trim()}
            title="Send steer"
          >
            <Send className="size-4" />
          </Button>

          <button
            onClick={() => rm.setPlayAll(!rm.playAll)}
            className={cn(
              "inline-flex size-9 shrink-0 items-center justify-center rounded-full border text-xs font-medium transition-colors",
              rm.playAll ? "border-primary/40 bg-primary/10 text-primary" : "border-border bg-elevated/60 text-muted-foreground hover:text-foreground",
            )}
            title="Play audio for all agents on this device"
          >
            {rm.playAll ? <Volume2 className="size-3.5" /> : <VolumeX className="size-3.5" />}
          </button>

          <div className="hidden">
            <input
              value={steer}
              onChange={(e) => setSteer(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && steer.trim()) {
                  rm.sendText(steer);
                  setSteer("");
                }
              }}
              placeholder="…or type a nudge to steer the agents"
              className="h-10 w-full rounded-md border border-border bg-input/70 px-3 text-sm text-foreground outline-none placeholder:text-muted-foreground focus-visible:border-primary/60 focus-visible:ring-2 focus-visible:ring-ring/40"
            />
            <Button
              variant="secondary"
              size="icon"
              onClick={() => {
                if (steer.trim()) {
                  rm.sendText(steer);
                  setSteer("");
                }
              }}
            >
              <Send className="size-4" />
            </Button>
          </div>
        </div>
        {rm.error && <p className="mx-auto mt-2 max-w-3xl text-[11px] text-destructive">{rm.error}</p>}
      </div>
    </Shell>
  );
}

function LiveVersionPanel({
  room,
  onChange,
  onAgentCountChange,
}: {
  room: PublicRoom;
  onChange: (profile: CapabilityProfileId) => void;
  onAgentCountChange: (agentCount: number) => void;
}) {
  const activeProfile = profileMeta(room.state.profile);
  const task = room.state.task;
  const roomStateItems = [
    ["version", activeProfile.short],
    ["agents", String(room.state.agentCount)],
    ["floor", room.agents[room.state.floorOwner]?.name ?? fallbackAgentName(room.state.floorOwner)],
    ["act", room.state.nextRequiredAct],
    ["turn", String(room.state.turn)],
    ["ack", room.state.suppressAcknowledgements ? "suppressed" : "allowed"],
    ["risk", room.state.loopRisk ? "true" : "false"],
  ];
  if (task?.kind === "count_to_n") {
    roomStateItems.splice(4, 0, ["count", `${task.next}/${task.target}`]);
  }

  return (
    <section className="shrink-0 border-b border-border bg-background/75 px-4 py-3">
      <div className="mx-auto max-w-5xl">
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <span className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Agent versions</span>
          <Badge variant="default" className="font-mono text-[10px]">
            active {activeProfile.short}
          </Badge>
          <span className="text-xs text-muted-foreground">
            Switches the live room behavior for every joined device.
          </span>
          <Button
            variant="outline"
            size="xs"
            onClick={() => onAgentCountChange(Math.min(MAX_AGENT_COUNT, room.state.agentCount + 1))}
            disabled={room.state.agentCount >= MAX_AGENT_COUNT}
            title="Add one more generated agent to this live room"
          >
            <Plus className="size-3.5" /> Agent
          </Button>
        </div>

        <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
          {PROFILE_OPTIONS.map((p) => {
            const active = room.state.profile === p.id;
            return (
              <button
                key={p.id}
                type="button"
                onClick={() => onChange(p.id)}
                className={cn(
                  "min-w-0 rounded-lg border p-2.5 text-left transition-colors",
                  active
                    ? "border-primary/60 bg-primary/[0.12] shadow-[0_0_0_1px_hsl(var(--primary)/0.2)_inset]"
                    : "border-border bg-card/55 hover:border-border-strong hover:bg-elevated/70",
                )}
                aria-pressed={active}
                title={`${p.label}: ${p.liveEffect}`}
              >
                <div className="flex items-center gap-2">
                  <span
                    className={cn(
                      "inline-flex size-7 shrink-0 items-center justify-center rounded-md border font-mono text-xs font-bold",
                      active ? "border-primary/50 bg-primary text-primary-foreground" : "border-border-strong bg-background text-foreground",
                    )}
                  >
                    {p.short}
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate text-xs font-bold text-foreground">{p.label}</span>
                    <span className="block truncate text-[10px] text-muted-foreground">{p.note}</span>
                  </span>
                </div>
                <div className="mt-2 space-y-1 font-mono text-[10px] leading-snug text-muted-foreground">
                  <p>
                    <span className="text-foreground/80">coord:</span> {p.coordination}
                  </p>
                  <p>
                    <span className="text-foreground/80">steer:</span> {p.steering}
                  </p>
                </div>
              </button>
            );
          })}
        </div>

        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-border bg-[hsl(223_30%_6%)]/70 px-3 py-2 font-mono text-[10px]">
          <span className="inline-flex items-center gap-1.5 font-sans font-bold uppercase tracking-wider text-success">
            <span className="size-1.5 animate-pulse rounded-full bg-success shadow-[0_0_6px_hsl(var(--success))]" />
            live roomState
          </span>
          {roomStateItems.map(([label, value]) => (
            <span key={label} className="inline-flex items-center gap-1 whitespace-nowrap">
              <span className="text-muted-foreground">{label}</span>
              <span className="font-semibold text-foreground">{value}</span>
            </span>
          ))}
        </div>
      </div>
    </section>
  );
}

function V3WorkPanel({
  room,
  onCancelWorker,
  onRetryWorker,
  onPolicyChange,
}: {
  room: PublicRoom;
  onCancelWorker: (workerId: string) => void;
  onRetryWorker: (workerId: string) => void;
  onPolicyChange: (policy: Partial<AgentOsPolicy>) => void;
}) {
  const goals = room.goals ?? [];
  const workers = room.workers ?? [];
  const artifacts = room.artifacts ?? [];
  const policy = room.policy ?? {
    budgetMaxWorkers: 16,
    budgetWorkersUsed: 0,
    permissionWebResearch: true,
    permissionExternalActions: false,
  };
  const runningWorkers = workers.filter((w) => w.status === "running").length;
  const queuedWorkers = workers.filter((w) => w.status === "queued").length;
  const completedWorkers = workers.filter((w) => w.status === "completed").length;
  const failedWorkers = workers.filter((w) => w.status === "failed").length;
  const blockedWorkers = workers.filter((w) => w.status === "blocked").length;
  const latestArtifacts = artifacts.slice(-3);
  const latestWorkers = workers.slice(-6);
  const selectedModel = room.models.find((m) => m.id === room.state.model);
  const webResearchModel = room.models.find((m) => m.id === WEB_RESEARCH_MODEL_ID);
  const expectedBatchCost = (selectedModel?.expectedCostUsd ?? 0) + (policy.permissionWebResearch ? (webResearchModel?.expectedCostUsd ?? 0) : 0);
  const expectedBatchLatency = Math.max(selectedModel?.expectedLatencyMs ?? 0, policy.permissionWebResearch ? (webResearchModel?.expectedLatencyMs ?? 0) : 0);
  const remainingWorkerBudget = Math.max(0, policy.budgetMaxWorkers - policy.budgetWorkersUsed);
  const expectedBudgetExposure = remainingWorkerBudget * (selectedModel?.expectedCostUsd ?? 0);
  const completedDurations = workers.map(workerRuntimeMs).filter((value): value is number => typeof value === "number");
  const observedAverageLatency = average(completedDurations);

  return (
    <section className="shrink-0 border-b border-border bg-card/45 px-4 py-2">
      <div className="mx-auto mb-2 flex max-w-5xl flex-wrap items-center gap-2 rounded-lg border border-border bg-background/45 px-2 py-1.5">
        <span className="inline-flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
          <ShieldCheck className="size-3.5 text-primary" /> Policy
        </span>
        <label className="inline-flex items-center gap-1 text-[10px] text-muted-foreground">
          workers
          <input
            type="number"
            min={1}
            max={200}
            value={policy.budgetMaxWorkers}
            onChange={(e) => onPolicyChange({ budgetMaxWorkers: Number(e.target.value) || 1 })}
            className="h-6 w-14 rounded border border-border bg-input/60 text-center font-mono text-[11px] text-foreground outline-none"
          />
          <span className="font-mono">{policy.budgetWorkersUsed}/{policy.budgetMaxWorkers}</span>
        </label>
        <button
          type="button"
          onClick={() => onPolicyChange({ permissionWebResearch: !policy.permissionWebResearch })}
          className={cn(
            "rounded border px-2 py-1 text-[10px] font-semibold",
            policy.permissionWebResearch ? "border-success/30 bg-success/10 text-success" : "border-border bg-muted text-muted-foreground",
          )}
          title="Allow hosted web-search workers."
        >
          web {policy.permissionWebResearch ? "on" : "off"}
        </button>
        <button
          type="button"
          onClick={() => onPolicyChange({ permissionExternalActions: !policy.permissionExternalActions })}
          className={cn(
            "rounded border px-2 py-1 text-[10px] font-semibold",
            policy.permissionExternalActions ? "border-warning/30 bg-warning/10 text-warning" : "border-border bg-muted text-muted-foreground",
          )}
          title="Future side-effect tools. Current workers remain read-only except artifact writes."
        >
          external {policy.permissionExternalActions ? "on" : "off"}
        </button>
        <span
          className="rounded border border-border bg-elevated/60 px-2 py-1 font-mono text-[10px] text-muted-foreground"
          title="Expected per foreground/model call from scripts/model-eval.mjs proofloop measurements."
        >
          model {formatDurationMs(selectedModel?.expectedLatencyMs)} {formatExpectedCost(selectedModel?.expectedCostUsd)}
        </span>
        <span
          className="rounded border border-border bg-elevated/60 px-2 py-1 font-mono text-[10px] text-muted-foreground"
          title="Expected next V3 planning workstream: execution-plan worker plus web-research worker when web is enabled. Web-search provider/tool fees are not included."
        >
          next v3 {formatDurationMs(expectedBatchLatency)} {formatExpectedCost(expectedBatchCost)}
        </span>
        <span
          className="rounded border border-border bg-elevated/60 px-2 py-1 font-mono text-[10px] text-muted-foreground"
          title="Rough remaining model-call exposure if the rest of the worker budget uses the selected room model."
        >
          exposure {formatExpectedCost(expectedBudgetExposure)}
        </span>
        <span
          className="rounded border border-border bg-elevated/60 px-2 py-1 font-mono text-[10px] text-muted-foreground"
          title="Observed average runtime for completed or terminal workers in this room."
        >
          observed {observedAverageLatency === null ? "n/a" : formatDurationMs(observedAverageLatency)}
        </span>
      </div>
      <div className="mx-auto grid max-h-44 max-w-5xl gap-2 overflow-y-auto md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)]">
        <div className="min-w-0">
          <div className="mb-1 flex items-center gap-2">
            <Badge variant="default" className="font-mono text-[10px]">V3</Badge>
            <span className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Goal Graph</span>
            <span className="font-mono text-[10px] text-muted-foreground">{goals.length}</span>
          </div>
          <div className="space-y-1">
            {goals.length === 0 ? (
              <p className="text-[11px] text-muted-foreground">No V3 goals yet. Steer the room to create one.</p>
            ) : (
              goals.slice(-4).map((goal) => (
                <div key={goal.id} className="rounded-md border border-border bg-background/55 px-2 py-1">
                  <div className="flex items-center gap-2">
                    <span className="rounded border border-border-strong px-1.5 py-0.5 font-mono text-[9px] text-muted-foreground">{goal.kind}</span>
                    <span className="min-w-0 flex-1 truncate text-xs font-medium text-foreground">{goal.title}</span>
                    <span className="font-mono text-[9px] text-muted-foreground">{goal.status}</span>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        <div className="min-w-0">
          <div className="mb-1 flex items-center gap-2">
            <span className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Workers</span>
            <span className="font-mono text-[10px] text-muted-foreground">
              q{queuedWorkers} r{runningWorkers} c{completedWorkers} f{failedWorkers} b{blockedWorkers}
            </span>
          </div>
          <div className="space-y-1">
            {latestWorkers.length === 0 ? (
              <p className="text-[11px] text-muted-foreground">Workers appear here when V3 spawns execution.</p>
            ) : (
              latestWorkers.map((worker) => (
                <div key={worker.id} className="rounded-md border border-border bg-background/55 px-2 py-1">
                  <div className="flex items-center gap-2">
                    <span
                      className={cn(
                        "rounded border px-1.5 py-0.5 font-mono text-[9px]",
                        worker.status === "completed"
                          ? "border-success/30 text-success"
                          : worker.status === "failed"
                            ? "border-destructive/40 text-destructive"
                            : worker.status === "running"
                              ? "border-primary/40 text-primary"
                              : "border-border-strong text-muted-foreground",
                      )}
                    >
                      {worker.status}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-xs text-foreground">{worker.title}</span>
                    {workerRuntimeMs(worker) !== null && (
                      <span className="font-mono text-[9px] text-muted-foreground">{formatDurationMs(workerRuntimeMs(worker) ?? undefined)}</span>
                    )}
                    {(worker.status === "queued" || worker.status === "running") && (
                      <Button variant="ghost" size="icon" onClick={() => onCancelWorker(worker.id)} title="Cancel worker" className="size-6">
                        <XCircle className="size-3.5" />
                      </Button>
                    )}
                    {(worker.status === "failed" || worker.status === "blocked" || worker.status === "canceled") && (
                      <Button variant="ghost" size="icon" onClick={() => onRetryWorker(worker.id)} title="Retry worker" className="size-6">
                        <RotateCcw className="size-3.5" />
                      </Button>
                    )}
                  </div>
                  {(worker.summary || worker.error) && <p className="mt-0.5 truncate text-[10px] text-muted-foreground">{worker.error ?? worker.summary}</p>}
                </div>
              ))
            )}
          </div>
        </div>

        <div className="min-w-0">
          <div className="mb-1 flex items-center gap-2">
            <span className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Artifacts</span>
            <span className="font-mono text-[10px] text-muted-foreground">{artifacts.length}</span>
          </div>
          <div className="space-y-1">
            {latestArtifacts.length === 0 ? (
              <p className="text-[11px] text-muted-foreground">Completed workers write artifacts here.</p>
            ) : (
              latestArtifacts.map((artifact) => (
                <details key={artifact.id} className="rounded-md border border-border bg-background/55 px-2 py-1">
                  <summary className="cursor-pointer truncate text-xs font-medium text-foreground">{artifact.title}</summary>
                  <pre className="mt-1 max-h-28 overflow-auto whitespace-pre-wrap font-mono text-[10px] leading-relaxed text-foreground/80">{artifact.content.slice(0, 1600)}</pre>
                </details>
              ))
            )}
          </div>
        </div>
      </div>
    </section>
  );
}

function ModelSelect({ rm }: { rm: ReturnType<typeof useRoom> }) {
  const room = rm.room!;
  const cur = room.models.find((m) => m.id === room.state.model);
  return (
    <label
      title={cur ? `${cur.tier} - ${cur.note} - ${formatDurationMs(cur.expectedLatencyMs)} / ${formatExpectedCost(cur.expectedCostUsd)} per model call` : "router model"}
      className="group relative flex h-8 items-center gap-1.5 rounded-md border border-border bg-elevated/70 pl-2 pr-6 text-xs transition-colors hover:border-border-strong focus-within:border-primary/60 focus-within:ring-2 focus-within:ring-ring/40"
    >
      <Cpu className="size-3.5 shrink-0 text-primary" />
      <select
        value={room.state.model}
        onChange={(e) => rm.setModel(e.target.value)}
        className="peer h-full max-w-[9rem] cursor-pointer appearance-none bg-transparent text-xs font-semibold text-foreground outline-none sm:max-w-[13rem]"
      >
        {room.models.map((m) => (
          <option key={m.id} value={m.id}>
            {m.label} - {m.tier} - {formatDurationMs(m.expectedLatencyMs)} - {formatExpectedCost(m.expectedCostUsd)}
          </option>
        ))}
      </select>
      <ChevronDown className="pointer-events-none absolute right-1.5 size-3.5 text-muted-foreground transition-colors group-focus-within:text-foreground" />
    </label>
  );
}

function UtteranceRow({ u, room, isFloor }: { u: RoomUtterance; room: PublicRoom; isFloor: boolean }) {
  const style = slotStyle(u.slot, room);
  function play() {
    const src = u.audioUrl ?? (u.audioId ? `${LIVE_BASE}/live/audio/${u.audioId}` : null);
    if (src) void new Audio(src).play().catch(() => {});
  }
  if (u.slot === "system") {
    return (
      <div className="flex justify-center py-1">
        <div className="max-w-[90%] rounded-full border border-border bg-elevated/70 px-3 py-1 text-center text-xs text-muted-foreground">
          {u.text}
        </div>
      </div>
    );
  }
  return (
    <div
      className={cn(
        "animate-fade-in-up rounded-xl border bg-card/60 p-3 transition-colors",
        isFloor ? "border-current/30" : "border-border",
        u.slot === "human" && "bg-primary/[0.06]",
      )}
    >
      <div className="mb-1 flex items-center gap-2">
        <span className={cn("flex size-5 shrink-0 items-center justify-center rounded-full text-[10px] font-bold ring-1 ring-inset", avatarStyle(u.slot, room))}>
          {avatarInitial(u.name)}
        </span>
        <span className={cn("text-[12px] font-bold", style.split(" ").find((c) => c.startsWith("text-")) ?? "text-foreground")}>{u.name}</span>
        <span className="rounded border border-border-strong px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">{u.speechAct}</span>
        {u.audioId && (
          <button onClick={play} className="ml-auto inline-flex items-center gap-1 rounded-md border border-border px-2 py-0.5 text-[10px] text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground">
            <Play className="size-3 fill-current" /> play
          </button>
        )}
      </div>
      <p className="text-sm leading-relaxed text-foreground/90">{u.text}</p>
    </div>
  );
}

/**
 * One-tap invite sharing: the native share sheet where it exists (iOS/Android
 * — iMessage, WhatsApp, etc.), clipboard with visible confirmation elsewhere.
 */
function ShareInvite({ joinUrl, code }: { joinUrl: string; code?: string }) {
  const [copied, setCopied] = React.useState(false);
  const text = `Join my Room OS live room — two AI voice agents + you.${code ? ` Code: ${code}` : ""}`;

  async function share() {
    // prefer the native share sheet (mobile)
    if (typeof navigator.share === "function") {
      try {
        await navigator.share({ title: "Room OS · Live", text, url: joinUrl });
        return;
      } catch (e) {
        if ((e as { name?: string })?.name === "AbortError") return; // user closed the sheet
        /* fall through to clipboard */
      }
    }
    try {
      await navigator.clipboard.writeText(`${text}\n${joinUrl}`);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      /* clipboard blocked — the URL is rendered next to the button anyway */
    }
  }

  return (
    <Button variant="outline" size="xs" onClick={() => void share()}>
      {copied ? <Check className="size-3.5 text-success" /> : <Share2 className="size-3.5" />}
      {copied ? "Copied!" : "Share invite"}
    </Button>
  );
}

/** Span-kind accents — dedicated palette, independent of status semantics
 *  (success/warning/destructive stay reserved for outcome, not category). */
const TRACE_STYLE: Record<string, string> = {
  state_reduced: "border-kind-reduced/30 bg-kind-reduced/10 text-kind-reduced",
  scheduler_selected: "border-kind-scheduled/30 bg-kind-scheduled/10 text-kind-scheduled",
  guardrail_evaluated: "border-kind-guardrail/30 bg-kind-guardrail/10 text-kind-guardrail",
  utterance_received: "border-kind-utterance/30 bg-kind-utterance/10 text-kind-utterance",
};
const TRACE_DOT: Record<string, string> = {
  state_reduced: "bg-kind-reduced shadow-[0_0_6px_hsl(var(--kind-reduced)/0.7)]",
  scheduler_selected: "bg-kind-scheduled shadow-[0_0_6px_hsl(var(--kind-scheduled)/0.7)]",
  guardrail_evaluated: "bg-kind-guardrail shadow-[0_0_6px_hsl(var(--kind-guardrail)/0.7)]",
  utterance_received: "bg-kind-utterance shadow-[0_0_6px_hsl(var(--kind-utterance)/0.7)]",
};

/** Timeline rail: a connecting line + colored dot per row, AgentPrism-style. */
function TraceTimeline({
  traces,
  openId,
  setOpenId,
}: {
  traces: TraceEvent[];
  openId: string | null;
  setOpenId: (updater: (v: string | null) => string | null) => void;
}) {
  const ordered = [...traces].reverse();
  if (ordered.length === 0) {
    return <p className="py-2 text-[11px] text-muted-foreground">No trace events yet — run a turn.</p>;
  }
  const counts = traces.reduce<Record<string, number>>((acc, t) => ({ ...acc, [t.kind]: (acc[t.kind] ?? 0) + 1 }), {});
  const span = traces.length >= 2 ? ((traces[traces.length - 1]!.ts - traces[0]!.ts) / 1000).toFixed(1) : "0.0";
  return (
    <div className="flex flex-col">
      <ol className="relative flex flex-col gap-0.5 border-l border-border/70 pl-3">
        {ordered.map((t) => (
          <li key={t.id} className="relative">
            <span
              className={cn(
                "absolute -left-[16.5px] top-[9px] size-1.5 rounded-full ring-2 ring-background",
                TRACE_DOT[t.kind] ?? "bg-muted-foreground/50",
              )}
            />
            <button
              onClick={() => setOpenId((v) => (v === t.id ? null : t.id))}
              className="w-full rounded-md border border-transparent px-2 py-1 text-left transition-colors hover:border-border-strong hover:bg-card/50"
            >
              <span className="flex items-center gap-2">
                <span className={cn("shrink-0 rounded px-1.5 py-0.5 font-mono text-[9px] font-bold uppercase tracking-wide border", TRACE_STYLE[t.kind] ?? "border-border-strong text-muted-foreground")}>
                  {t.kind.replace(/_/g, " ")}
                </span>
                <span className="min-w-0 flex-1 truncate text-[11px] text-foreground/85">{t.summary}</span>
                <span className="shrink-0 font-mono text-[9px] text-muted-foreground">
                  {new Date(t.ts).toLocaleTimeString([], { hour12: false })}
                </span>
              </span>
              {openId === t.id && t.payload !== undefined && (
                <pre className="mt-1 overflow-x-auto rounded bg-background/70 p-2 font-mono text-[10px] leading-relaxed text-emerald-200/90">
                  {JSON.stringify(t.payload, null, 2)}
                </pre>
              )}
            </button>
          </li>
        ))}
      </ol>
      {traces.length > 0 && (
        <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-border/60 pt-1.5 pl-3 font-mono text-[9px] text-muted-foreground">
          <span>{traces.length} events · {span}s span</span>
          {Object.entries(counts).map(([kind, n]) => (
            <span key={kind} className={cn("inline-flex items-center gap-1", TRACE_STYLE[kind]?.split(" ").find((c) => c.startsWith("text-")) ?? "")}>
              <span className={cn("size-1 rounded-full", TRACE_DOT[kind] ?? "bg-muted-foreground/50")} />
              {kind.replace(/_/g, " ")} · {n}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * The proof layer, visible: every decision the room made — classify → reduce →
 * guard → schedule — as an auditable event stream. Newest first. This is what
 * separates "trust me, it coordinated" from "here is why it coordinated".
 */
function TracePanel({ traces }: { traces: TraceEvent[] }) {
  const [openId, setOpenId] = React.useState<string | null>(null);
  return (
    <div className="max-h-56 shrink-0 overflow-y-auto border-t border-border bg-[hsl(223_30%_6%)]/95 px-4 py-2 backdrop-blur">
      <div className="mx-auto max-w-3xl">
        <div className="mb-1.5 flex items-center gap-2">
          <ListTree className="size-3.5 text-primary" />
          <span className="text-[11px] font-bold tracking-wide text-primary">Trace Inspector</span>
          <span className="text-[10px] text-muted-foreground">classify → reduce → guard → schedule · click a row for the payload</span>
        </div>
        <TraceTimeline traces={traces} openId={openId} setOpenId={setOpenId} />
      </div>
    </div>
  );
}

function StateInspector({ room }: { room: PublicRoom }) {
  const [openId, setOpenId] = React.useState<string | null>(null);
  const traces = room.traces ?? [];
  const stateSnapshot = {
    room: {
      id: room.id,
      code: room.code,
      private: Boolean(room.private),
    },
    policy: room.policy ?? null,
    models: room.models,
    state: room.state,
    agents: activeSlots(room.state.agentCount).map((slot) => {
      const agent = room.agents[slot];
      return {
        slot,
        name: agent?.name ?? fallbackAgentName(slot),
        device: agent?.device ?? "unassigned",
        color: agent?.color ?? "default",
      };
    }),
    participants: room.participants,
    utterances: {
      total: room.utterances.length,
      rendered: Math.min(room.utterances.length, VISIBLE_UTTERANCE_LIMIT),
      renderLimit: VISIBLE_UTTERANCE_LIMIT,
    },
    traces: {
      total: traces.length,
    },
    v3: {
      goals: room.goals ?? [],
      tasks: room.tasks ?? [],
      workers: room.workers ?? [],
      artifacts: room.artifacts ?? [],
      world: room.world ?? { beliefs: [] },
    },
  };

  return (
    <div className="max-h-[min(44vh,26rem)] shrink-0 overflow-hidden border-t border-border bg-[hsl(223_30%_6%)]/95 px-4 py-2 backdrop-blur">
      <div className="mx-auto grid h-full max-w-6xl gap-3 md:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)]">
        <div className="min-h-0 overflow-y-auto rounded-lg border border-border/70 bg-background/40 p-2">
          <div className="mb-1.5 flex items-center gap-2">
            <ListTree className="size-3.5 text-primary" />
            <span className="text-[11px] font-bold tracking-wide text-primary">Internal State</span>
            <span className="text-[10px] text-muted-foreground">live reducer snapshot</span>
          </div>
          <pre className="overflow-x-auto rounded bg-background/70 p-2 font-mono text-[10px] leading-relaxed text-emerald-200/90">
            {JSON.stringify(stateSnapshot, null, 2)}
          </pre>
        </div>
        <div className="min-h-0 overflow-y-auto">
          <div className="mb-1.5 flex items-center gap-2">
            <ListTree className="size-3.5 text-primary" />
            <span className="text-[11px] font-bold tracking-wide text-primary">Trace Inspector</span>
            <span className="text-[10px] text-muted-foreground">click a row for payload</span>
          </div>
          <TraceTimeline traces={traces} openId={openId} setOpenId={setOpenId} />
        </div>
      </div>
    </div>
  );
}

function RoomStateBar({ room }: { room: PublicRoom }) {
  const s = room.state;
  const item = (label: string, value: React.ReactNode, slot?: Slot) => (
    <span className="inline-flex items-center gap-1 whitespace-nowrap">
      <span className="text-muted-foreground">{label}</span>
      <span className={cn("font-semibold", slot ? slotStyle(slot, room).split(" ")[0] : "text-foreground")}>{value}</span>
    </span>
  );
  return (
    <div className="shrink-0 overflow-x-auto border-t border-border bg-[hsl(223_30%_6%)]/95 px-4 py-1.5 font-mono text-[11px] backdrop-blur">
      <div className="mx-auto flex max-w-3xl items-center gap-4">
        <span className="inline-flex items-center gap-1.5 font-sans text-[10px] font-bold uppercase tracking-wider text-success">
          <span className="size-1.5 animate-pulse rounded-full bg-success shadow-[0_0_6px_hsl(var(--success))]" />
          roomState
        </span>
        {item("floor", room.agents[s.floorOwner]?.name ?? fallbackAgentName(s.floorOwner), s.floorOwner)}
        {item("turn", s.turn)}
        {item("act", s.nextRequiredAct)}
        {s.task?.kind === "count_to_n" && item("count", `${s.task.next}/${s.task.target}`)}
        {item("suppressAck", String(s.suppressAcknowledgements))}
        {item("loopRisk", String(s.loopRisk))}
        {item("done", String(s.done))}
      </div>
    </div>
  );
}
