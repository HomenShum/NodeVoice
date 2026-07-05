import * as React from "react";

export type Slot = "a" | "b";
export type MySlot = Slot | "spectator";

export interface RoomAgent {
  slot: Slot;
  name: string;
  device: string;
  color: string;
  persona: string;
}
export interface RoomUtterance {
  id: string;
  slot: Slot | "human" | "system";
  name: string;
  text: string;
  speechAct: string;
  ts: number;
  audioId?: string;
}
export interface RouterModel {
  id: string;
  label: string;
  tier: string;
  note: string;
}
export interface PublicRoom {
  id: string;
  agents: { a: RoomAgent; b: RoomAgent };
  state: {
    goal: string;
    model: string;
    floorOwner: Slot;
    nextSpeaker: Slot;
    turn: number;
    running: boolean;
    done: boolean;
    loopRisk: boolean;
    nextRequiredAct: string;
    suppressAcknowledgements: boolean;
  };
  models: RouterModel[];
  participants: { slot: string; kind: string }[];
  utterances: RoomUtterance[];
}

async function post<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method: "POST",
    headers: body ? { "content-type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`${path} → ${res.status}`);
  return (await res.json()) as T;
}

function pickRecorderMime(): string {
  const candidates = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg"];
  for (const c of candidates) {
    if (typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported?.(c)) return c;
  }
  return "";
}

export function useRoom() {
  const [room, setRoom] = React.useState<PublicRoom | null>(null);
  const [connected, setConnected] = React.useState(false);
  const [mySlot, setMySlot] = React.useState<MySlot>("spectator");
  const [error, setError] = React.useState<string | null>(null);
  const [recording, setRecording] = React.useState(false);
  const [playAll, setPlayAll] = React.useState(false);

  const esRef = React.useRef<EventSource | null>(null);
  const audioRef = React.useRef<HTMLAudioElement | null>(null);
  const queueRef = React.useRef<string[]>([]);
  const playingRef = React.useRef(false);
  const mySlotRef = React.useRef<MySlot>("spectator");
  const playAllRef = React.useRef(false);
  const recorderRef = React.useRef<MediaRecorder | null>(null);
  const chunksRef = React.useRef<Blob[]>([]);
  // Polling fallback (measured: cloudflared quick tunnels buffer SSE — the
  // stream opens but events never arrive, so remote joiners would freeze).
  const pollTimerRef = React.useRef<ReturnType<typeof setInterval> | null>(null);
  const seenAudioRef = React.useRef<Set<string>>(new Set());
  const seededRef = React.useRef(false);

  React.useEffect(() => {
    mySlotRef.current = mySlot;
  }, [mySlot]);
  React.useEffect(() => {
    playAllRef.current = playAll;
  }, [playAll]);

  const drainQueue = React.useCallback(() => {
    if (playingRef.current) return;
    const next = queueRef.current.shift();
    if (!next) return;
    const el = audioRef.current ?? new Audio();
    audioRef.current = el;
    playingRef.current = true;
    el.src = `/live/audio/${next}`;
    el.onended = () => {
      playingRef.current = false;
      drainQueue();
    };
    el.onerror = () => {
      playingRef.current = false;
      drainQueue();
    };
    el.play().catch(() => {
      playingRef.current = false;
    });
  }, []);

  const enqueueAudio = React.useCallback(
    (audioId: string) => {
      queueRef.current.push(audioId);
      drainQueue();
    },
    [drainQueue],
  );

  /** Remember an audioId so it is never double-played (bounded set). */
  const rememberAudio = React.useCallback((audioId: string) => {
    const seen = seenAudioRef.current;
    if (seen.has(audioId)) return false;
    seen.add(audioId);
    if (seen.size > 500) {
      const first = seen.values().next().value as string | undefined;
      if (first) seen.delete(first);
    }
    return true;
  }, []);

  /** Seed the seen-set from a snapshot so joining never replays history. */
  const seedFromRoom = React.useCallback((r: PublicRoom) => {
    if (seededRef.current) return;
    for (const u of r.utterances) if (u.audioId) seenAudioRef.current.add(u.audioId);
    seededRef.current = true;
  }, []);

  const stopPolling = React.useCallback(() => {
    if (pollTimerRef.current) {
      clearInterval(pollTimerRef.current);
      pollTimerRef.current = null;
    }
  }, []);

  /** Snapshot polling — the transport of last resort, but it always works. */
  const startPolling = React.useCallback((id: string) => {
    if (pollTimerRef.current) return;
    const tick = async () => {
      try {
        const res = await fetch(`/live/rooms/${id}`);
        if (!res.ok) return;
        const j = (await res.json()) as { room?: PublicRoom };
        const r = j.room;
        if (!r) return;
        setConnected(true);
        if (!seededRef.current) {
          seedFromRoom(r);
        } else {
          for (const u of r.utterances) {
            if (u.audioId && rememberAudio(u.audioId)) {
              const forMe = playAllRef.current || u.slot === mySlotRef.current;
              if (forMe) enqueueAudio(u.audioId);
            }
          }
        }
        setRoom(r);
      } catch {
        setConnected(false);
      }
    };
    void tick();
    pollTimerRef.current = setInterval(tick, 1500);
  }, [enqueueAudio, rememberAudio, seedFromRoom]);

  const connect = React.useCallback((id: string) => {
    esRef.current?.close();
    stopPolling();

    let es: EventSource | null = null;
    try {
      es = new EventSource(`/live/rooms/${id}/events`);
    } catch {
      startPolling(id); // no EventSource in this environment
      return;
    }
    esRef.current = es;

    // Watchdog: SSE can "open" through a buffering proxy (cloudflared quick
    // tunnel) yet never deliver events. If no message lands in time, fall back
    // to polling for the rest of the session.
    let gotMessage = false;
    const watchdog = setTimeout(() => {
      if (!gotMessage) {
        es?.close();
        setConnected(false);
        startPolling(id);
      }
    }, 4000);

    es.onopen = () => setConnected(true);
    es.onerror = () => {
      setConnected(false);
      if (!gotMessage) {
        clearTimeout(watchdog);
        es?.close();
        startPolling(id);
      }
    };
    es.onmessage = (ev) => {
      gotMessage = true;
      let msg: { type: string; room?: PublicRoom; audioId?: string; slot?: Slot };
      try {
        msg = JSON.parse(ev.data);
      } catch {
        return;
      }
      if (msg.type === "state" && msg.room) {
        seedFromRoom(msg.room);
        setRoom(msg.room);
      } else if (msg.type === "utterance" && (msg as { utterance?: RoomUtterance }).utterance) {
        const u = (msg as { utterance: RoomUtterance }).utterance;
        setRoom((prev) => (prev && !prev.utterances.some((x) => x.id === u.id) ? { ...prev, utterances: [...prev.utterances, u] } : prev));
      } else if (msg.type === "speak" && msg.audioId) {
        if (rememberAudio(msg.audioId)) {
          const forMe = playAllRef.current || msg.slot === mySlotRef.current;
          if (forMe) enqueueAudio(msg.audioId);
        }
      }
    };
  }, [enqueueAudio, rememberAudio, seedFromRoom, startPolling, stopPolling]);

  React.useEffect(
    () => () => {
      esRef.current?.close();
      if (pollTimerRef.current) clearInterval(pollTimerRef.current);
    },
    [],
  );

  /** Unlock audio playback on iOS with a user gesture (call from a click). */
  const unlockAudio = React.useCallback(() => {
    const el = audioRef.current ?? new Audio();
    audioRef.current = el;
    el.muted = true;
    el.play().catch(() => {});
    el.pause();
    el.muted = false;
    el.currentTime = 0;
  }, []);

  const createRoom = React.useCallback(async (goal: string, model?: string) => {
    setError(null);
    try {
      const r = await post<{ roomId: string; room: PublicRoom }>("/live/rooms", { goal, model });
      await post(`/live/rooms/${r.roomId}/join`, { slot: "a", kind: "creator" });
      setMySlot("a");
      setRoom(r.room);
      connect(r.roomId);
      return r.roomId;
    } catch (e) {
      setError(`Could not create room: ${String(e)}`);
      return null;
    }
  }, [connect]);

  const joinRoom = React.useCallback(async (id: string, slot: MySlot) => {
    setError(null);
    try {
      const r = await post<{ room: PublicRoom; slot: MySlot }>(`/live/rooms/${id}/join`, { slot, kind: "device" });
      setMySlot(slot);
      setRoom(r.room);
      connect(id);
      return true;
    } catch (e) {
      setError(`Could not join room ${id}: ${String(e)}`);
      return false;
    }
  }, [connect]);

  const setGoal = React.useCallback((goal: string) => {
    if (room) void post(`/live/rooms/${room.id}/goal`, { goal }).catch(() => {});
  }, [room]);

  const setModel = React.useCallback((model: string) => {
    if (room) void post(`/live/rooms/${room.id}/model`, { model }).catch((e) => setError(String(e)));
  }, [room]);

  const setRunning = React.useCallback((running: boolean) => {
    if (room) void post(`/live/rooms/${room.id}/run`, { running }).catch((e) => setError(String(e)));
  }, [room]);

  const step = React.useCallback(() => {
    if (room) void post(`/live/rooms/${room.id}/step`).catch((e) => setError(String(e)));
  }, [room]);

  const sendText = React.useCallback((text: string) => {
    if (room && text.trim()) void post(`/live/rooms/${room.id}/human`, { text: text.trim() }).catch((e) => setError(String(e)));
  }, [room]);

  const beginTalk = React.useCallback(async () => {
    if (!room || recording) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mime = pickRecorderMime();
      const rec = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream);
      chunksRef.current = [];
      rec.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      rec.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(chunksRef.current, { type: rec.mimeType || "audio/webm" });
        if (blob.size < 800) return; // ignore accidental taps
        try {
          const res = await fetch(`/live/rooms/${room.id}/human`, {
            method: "POST",
            headers: { "content-type": rec.mimeType || "audio/webm" },
            body: blob,
          });
          if (!res.ok) setError(`transcription failed (${res.status})`);
        } catch (e) {
          setError(String(e));
        }
      };
      recorderRef.current = rec;
      rec.start();
      setRecording(true);
    } catch (e) {
      setError(`Mic unavailable: ${String(e)}`);
    }
  }, [room, recording]);

  const endTalk = React.useCallback(() => {
    const rec = recorderRef.current;
    if (rec && rec.state !== "inactive") rec.stop();
    setRecording(false);
  }, []);

  return {
    room,
    connected,
    mySlot,
    setMySlot,
    error,
    setError,
    recording,
    playAll,
    setPlayAll,
    createRoom,
    joinRoom,
    setGoal,
    setModel,
    setRunning,
    step,
    sendText,
    beginTalk,
    endTalk,
    unlockAudio,
  };
}
