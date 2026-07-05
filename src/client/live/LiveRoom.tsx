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
  Loader,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Qr } from "./Qr";
import { useRoom, LIVE_BASE, type Slot, type MySlot, type RoomUtterance, type PublicRoom } from "./roomClient";

const DEFAULT_GOAL =
  "Plan a great Saturday for two friends in San Francisco and agree on a final 3-stop itinerary with rough timing.";

const SLOT_STYLE: Record<string, string> = {
  a: "text-sky-300 bg-sky-500/10 border-sky-400/30",
  b: "text-violet-300 bg-violet-500/10 border-violet-400/30",
  human: "text-primary bg-primary/10 border-primary/30",
  system: "text-muted-foreground bg-muted border-border",
};

export default function LiveRoom() {
  const rm = useRoom();
  const params = React.useMemo(() => new URLSearchParams(window.location.search), []);
  const joinId = params.get("room");
  const [joined, setJoined] = React.useState(false);

  if (rm.room && (joined || rm.mySlot === "a")) {
    return <InRoom rm={rm} />;
  }
  if (joinId) {
    return <JoinGate rm={rm} roomId={joinId} onJoined={() => setJoined(true)} />;
  }
  return <Lobby rm={rm} />;
}

/* ── shell ─────────────────────────────────────────────────────────── */
function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative flex min-h-screen flex-col bg-background text-foreground">
      <div className="bg-grid pointer-events-none fixed inset-0 opacity-[0.25] [mask-image:radial-gradient(70%_60%_at_50%_0%,black,transparent)]" />
      <div className="relative flex flex-1 flex-col">{children}</div>
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
function Lobby({ rm }: { rm: ReturnType<typeof useRoom> }) {
  const [goal, setGoal] = React.useState(DEFAULT_GOAL);
  const [busy, setBusy] = React.useState(false);

  async function create() {
    setBusy(true);
    rm.unlockAudio();
    await rm.createRoom(goal.trim() || DEFAULT_GOAL);
    setBusy(false);
  }

  return (
    <Shell>
      <div className="flex flex-1 items-center justify-center px-6 py-12">
        <div className="w-full max-w-xl">
          <div className="mb-6 flex justify-center">
            <Brand tag="two agents · one shared room · live voice" />
          </div>
          <Badge variant="outline" className="mb-4 gap-1.5">
            <span className="size-1.5 rounded-full bg-success shadow-[0_0_6px_hsl(var(--success))]" />
            local-first · your keys, server-side
          </Badge>
          <h2 className="text-balance text-2xl font-bold tracking-tight sm:text-3xl">
            Start a live room. Two voice agents{" "}
            <span className="bg-gradient-to-r from-primary to-success bg-clip-text text-transparent">actually talk it out.</span>
          </h2>
          <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
            This device becomes <span className="font-semibold text-sky-300">Ada</span> (laptop). Scan the QR from your phone to add{" "}
            <span className="font-semibold text-violet-300">Ben</span>. They collaborate on your goal through one shared room — and you can jump in by voice anytime.
          </p>

          <label className="mt-6 block text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Shared goal</label>
          <textarea
            value={goal}
            onChange={(e) => setGoal(e.target.value)}
            rows={3}
            className="mt-1.5 w-full resize-none rounded-lg border border-border bg-input/70 px-3.5 py-2.5 text-sm text-foreground outline-none transition-colors placeholder:text-muted-foreground focus-visible:border-primary/60 focus-visible:ring-2 focus-visible:ring-ring/40"
            placeholder="What should the agents work on together?"
          />

          <div className="mt-5 flex items-center gap-3">
            <Button size="lg" onClick={create} disabled={busy} className="px-7">
              {busy ? <Loader className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
              {busy ? "Creating…" : "Create room"}
            </Button>
            <a href="/demo" className="text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline">
              or watch the bad-vs-good demo →
            </a>
          </div>
          {rm.error && <p className="mt-3 text-xs text-destructive">{rm.error}</p>}
        </div>
      </div>
    </Shell>
  );
}

/* ── join gate (phone via QR) ──────────────────────────────────────── */
function JoinGate({ rm, roomId, onJoined }: { rm: ReturnType<typeof useRoom>; roomId: string; onJoined: () => void }) {
  const [slot, setSlot] = React.useState<MySlot>("b");
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
          <p className="mt-2 text-sm text-muted-foreground">Pick which agent this device voices, then enable sound.</p>

          <div className="mt-5 grid grid-cols-3 gap-2">
            {([
              { k: "b" as MySlot, label: "Ben", sub: "phone agent", cls: SLOT_STYLE.b },
              { k: "a" as MySlot, label: "Ada", sub: "laptop agent", cls: SLOT_STYLE.a },
              { k: "spectator" as MySlot, label: "Watch", sub: "listen only", cls: SLOT_STYLE.system },
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
  const [showQr, setShowQr] = React.useState(rm.mySlot === "a");
  const scrollRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [room.utterances.length]);

  const meName = rm.mySlot === "a" ? room.agents.a.name : rm.mySlot === "b" ? room.agents.b.name : "spectator";

  return (
    <Shell>
      {/* top bar */}
      <header className="z-20 flex shrink-0 flex-wrap items-center gap-x-3 gap-y-2 border-b border-border bg-card/80 px-4 py-2.5 backdrop-blur">
        <Brand tag={`room ${room.id}`} />
        <div className="ml-auto flex items-center gap-2">
          <ModelSelect rm={rm} />
          <span
            className={cn(
              "inline-flex items-center gap-1.5 rounded-full border px-2 py-1 text-[11px] font-medium",
              rm.connected ? "border-success/40 text-success" : "border-border text-muted-foreground",
            )}
          >
            <span className={cn("size-1.5 rounded-full", rm.connected ? "bg-success animate-pulse" : "bg-muted-foreground")} />
            {rm.connected ? "live" : "connecting…"}
          </span>
          <span className={cn("rounded-full border px-2 py-1 text-[11px] font-semibold", SLOT_STYLE[rm.mySlot] ?? SLOT_STYLE.system)}>
            you: {meName}
          </span>
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
          <span className="shrink-0 font-mono text-[11px] text-muted-foreground">turn {room.state.turn}</span>
          {room.state.done && <Badge variant="success" dot>agreed</Badge>}
          {room.state.loopRisk && !room.state.done && <Badge variant="warning" dot>loop risk</Badge>}
        </div>
      </div>

      {showQr && (
        <div className="flex shrink-0 flex-col items-center gap-3 border-b border-border bg-primary/[0.04] px-4 py-4 sm:flex-row sm:justify-center">
          <Qr value={joinUrl} size={148} />
          <div className="text-center sm:text-left">
            <p className="text-sm font-semibold">Scan from your phone to add Ben</p>
            <p className="mt-0.5 text-xs text-muted-foreground">Both devices join the same room. Keep them near each other to hear the conversation.</p>
            <div className="mt-2 flex items-center justify-center gap-1.5 sm:justify-start">
              <LinkIcon className="size-3.5 text-muted-foreground" />
              <code className="rounded bg-elevated px-1.5 py-0.5 text-[11px] text-primary">{joinUrl}</code>
            </div>
          </div>
        </div>
      )}

      {/* transcript */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-4">
        <div className="mx-auto flex max-w-3xl flex-col gap-2.5">
          {room.utterances.length === 0 && (
            <div className="mt-10 text-center text-sm text-muted-foreground">
              Press <span className="font-semibold text-foreground">Start</span> to let {room.agents.a.name} and {room.agents.b.name} begin — or hold the mic to speak first.
            </div>
          )}
          {room.utterances.map((u) => (
            <UtteranceRow key={u.id} u={u} isFloor={u.slot === room.state.floorOwner} />
          ))}
        </div>
      </div>

      {/* room state inspector */}
      <RoomStateBar room={room} />

      {/* controls */}
      <div className="shrink-0 border-t border-border bg-card/80 px-4 py-3 backdrop-blur">
        <div className="mx-auto flex max-w-3xl flex-wrap items-center gap-2">
          {room.state.running ? (
            <Button variant="outline" size="default" onClick={() => rm.setRunning(false)}>
              <Pause className="size-4" /> Pause
            </Button>
          ) : (
            <Button size="default" onClick={() => rm.setRunning(true)} disabled={room.state.done}>
              <Play className="size-4 fill-current" /> {room.state.turn === 0 ? "Start" : "Resume"}
            </Button>
          )}
          <Button variant="outline" size="default" onClick={rm.step} disabled={room.state.running}>
            <StepForward className="size-4" /> Step
          </Button>

          {/* press-to-talk */}
          <button
            onPointerDown={(e) => {
              e.preventDefault();
              void rm.beginTalk();
            }}
            onPointerUp={rm.endTalk}
            onPointerLeave={() => rm.recording && rm.endTalk()}
            className={cn(
              "inline-flex select-none items-center gap-1.5 rounded-md px-4 py-2 text-sm font-medium transition-all",
              rm.recording
                ? "bg-destructive text-destructive-foreground shadow-[0_0_0_4px_hsl(var(--destructive)/0.25)]"
                : "border border-border-strong bg-elevated/60 text-foreground hover:border-primary/40",
            )}
            title="Hold to talk"
          >
            <Mic className={cn("size-4", rm.recording && "animate-pulse")} />
            {rm.recording ? "Listening… release to send" : "Hold to talk"}
          </button>

          <button
            onClick={() => rm.setPlayAll(!rm.playAll)}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-md border px-2.5 py-2 text-xs font-medium transition-colors",
              rm.playAll ? "border-primary/40 bg-primary/10 text-primary" : "border-border bg-elevated/60 text-muted-foreground hover:text-foreground",
            )}
            title="Play audio for both agents on this device"
          >
            {rm.playAll ? <Volume2 className="size-3.5" /> : <VolumeX className="size-3.5" />}
            hear both
          </button>

          <div className="flex min-w-40 flex-1 items-center gap-2">
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

function ModelSelect({ rm }: { rm: ReturnType<typeof useRoom> }) {
  const room = rm.room!;
  const cur = room.models.find((m) => m.id === room.state.model);
  return (
    <label
      title={cur ? `${cur.tier} — ${cur.note}` : "router model"}
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
            {m.label} · {m.tier}
          </option>
        ))}
      </select>
      <ChevronDown className="pointer-events-none absolute right-1.5 size-3.5 text-muted-foreground transition-colors group-focus-within:text-foreground" />
    </label>
  );
}

function UtteranceRow({ u, isFloor }: { u: RoomUtterance; isFloor: boolean }) {
  const style = SLOT_STYLE[u.slot] ?? SLOT_STYLE.system;
  function play() {
    const src = u.audioUrl ?? (u.audioId ? `${LIVE_BASE}/live/audio/${u.audioId}` : null);
    if (src) void new Audio(src).play().catch(() => {});
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
        <span className={cn("rounded-full border px-2 py-0.5 text-[11px] font-bold", style)}>{u.name}</span>
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

function RoomStateBar({ room }: { room: PublicRoom }) {
  const s = room.state;
  const item = (label: string, value: React.ReactNode, slot?: Slot) => (
    <span className="inline-flex items-center gap-1 whitespace-nowrap">
      <span className="text-muted-foreground">{label}</span>
      <span className={cn("font-semibold", slot ? SLOT_STYLE[slot]?.split(" ")[0] : "text-foreground")}>{value}</span>
    </span>
  );
  return (
    <div className="shrink-0 overflow-x-auto border-t border-border bg-[hsl(223_30%_6%)]/95 px-4 py-1.5 font-mono text-[11px] backdrop-blur">
      <div className="mx-auto flex max-w-3xl items-center gap-4">
        <span className="inline-flex items-center gap-1.5 font-sans text-[10px] font-bold uppercase tracking-wider text-success">
          <span className="size-1.5 animate-pulse rounded-full bg-success shadow-[0_0_6px_hsl(var(--success))]" />
          roomState
        </span>
        {item("floor", room.agents[s.floorOwner]?.name ?? s.floorOwner, s.floorOwner)}
        {item("turn", s.turn)}
        {item("act", s.nextRequiredAct)}
        {item("suppressAck", String(s.suppressAcknowledgements))}
        {item("loopRisk", String(s.loopRisk))}
        {item("done", String(s.done))}
      </div>
    </div>
  );
}
