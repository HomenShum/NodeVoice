import * as React from "react";
import { useQuery, useMutation, useAction, useConvex } from "convex/react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import type { MySlot, PublicRoom, RoomUtterance } from "./useRoom";

/**
 * Fully reactive room client. Drop-in replacement for the HTTP useRoom():
 * state arrives over Convex's WebSocket subscription (useQuery re-renders on
 * every mutation server-side) — no SSE, no polling, no tunnel. Requires a
 * <ConvexProvider> ancestor; selected at build time via VITE_CONVEX_URL.
 */
export function useConvexRoom() {
  const convex = useConvex();
  const [roomId, setRoomId] = React.useState<Id<"rooms"> | null>(null);
  const [mySlot, setMySlot] = React.useState<MySlot>("spectator");
  const [error, setError] = React.useState<string | null>(null);
  const [recording, setRecording] = React.useState(false);
  const [playAll, setPlayAll] = React.useState(false);

  const snapshot = useQuery(api.rooms.watchRoom, roomId ? { roomId } : "skip");
  const room = (snapshot ?? null) as PublicRoom | null;
  const connected = roomId != null && snapshot !== undefined;

  const createRoomMut = useMutation(api.rooms.createRoom);
  const joinRoomMut = useMutation(api.rooms.joinRoom);
  const setGoalMut = useMutation(api.rooms.setGoal);
  const setModelMut = useMutation(api.rooms.setModel);
  const setRunningMut = useMutation(api.rooms.setRunning);
  const submitHumanMut = useMutation(api.rooms.submitHuman);
  const stepAction = useAction(api.coordinator.stepOnce);
  const transcribeAction = useAction(api.coordinator.transcribeHuman);

  // ── audio playback (URL queue; utterances carry storage audioUrl) ──
  const audioRef = React.useRef<HTMLAudioElement | null>(null);
  const queueRef = React.useRef<string[]>([]);
  const playingRef = React.useRef(false);
  const seenRef = React.useRef<Set<string>>(new Set());
  const seededRef = React.useRef(false);
  const mySlotRef = React.useRef<MySlot>("spectator");
  const playAllRef = React.useRef(false);
  const recorderRef = React.useRef<MediaRecorder | null>(null);
  const chunksRef = React.useRef<Blob[]>([]);

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
    el.src = next;
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

  // React to new utterances from the reactive snapshot: play unseen audio.
  React.useEffect(() => {
    const utterances = room?.utterances;
    if (!utterances) return;
    if (!seededRef.current) {
      // joining never replays history
      for (const u of utterances) seenRef.current.add(u.id);
      seededRef.current = true;
      return;
    }
    for (const u of utterances as RoomUtterance[]) {
      if (seenRef.current.has(u.id)) continue;
      seenRef.current.add(u.id);
      if (seenRef.current.size > 600) {
        const first = seenRef.current.values().next().value as string | undefined;
        if (first) seenRef.current.delete(first);
      }
      const url = u.audioUrl;
      if (url && (playAllRef.current || u.slot === mySlotRef.current)) {
        queueRef.current.push(url);
        drainQueue();
      }
    }
  }, [room?.utterances, drainQueue]);

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

  const createRoom = React.useCallback(
    async (goal: string, model?: string) => {
      setError(null);
      try {
        const id = await createRoomMut({ goal, model });
        await joinRoomMut({ roomId: id, slot: "a", kind: "creator" });
        setMySlot("a");
        setRoomId(id);
        return id as string;
      } catch (e) {
        setError(`Could not create room: ${String(e).slice(0, 160)}`);
        return null;
      }
    },
    [createRoomMut, joinRoomMut],
  );

  const joinRoom = React.useCallback(
    async (id: string, slot: MySlot) => {
      setError(null);
      try {
        const rid = id as Id<"rooms">;
        // validate the id before subscribing (throws on bad/unknown id)
        const snap = await convex.query(api.rooms.watchRoom, { roomId: rid });
        if (!snap) throw new Error("room not found");
        await joinRoomMut({ roomId: rid, slot: slot === "a" || slot === "b" ? slot : "spectator" });
        setMySlot(slot);
        setRoomId(rid);
        return true;
      } catch (e) {
        setError(`Could not join room ${id}: ${String(e).slice(0, 160)}`);
        return false;
      }
    },
    [convex, joinRoomMut],
  );

  const setGoal = React.useCallback(
    (goal: string) => {
      if (roomId) void setGoalMut({ roomId, goal }).catch(() => {});
    },
    [roomId, setGoalMut],
  );

  const setModel = React.useCallback(
    (model: string) => {
      if (roomId) void setModelMut({ roomId, model }).catch((e) => setError(String(e).slice(0, 160)));
    },
    [roomId, setModelMut],
  );

  const setRunning = React.useCallback(
    (running: boolean) => {
      if (roomId) void setRunningMut({ roomId, running }).catch((e) => setError(String(e).slice(0, 160)));
    },
    [roomId, setRunningMut],
  );

  const step = React.useCallback(() => {
    if (roomId) void stepAction({ roomId }).catch((e) => setError(String(e).slice(0, 160)));
  }, [roomId, stepAction]);

  const sendText = React.useCallback(
    (text: string) => {
      if (roomId && text.trim()) void submitHumanMut({ roomId, text: text.trim() }).catch((e) => setError(String(e).slice(0, 160)));
    },
    [roomId, submitHumanMut],
  );

  const beginTalk = React.useCallback(async () => {
    if (!roomId || recording) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const candidates = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg"];
      const mime = candidates.find((c) => typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported?.(c)) ?? "";
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
          const audioBase64 = await new Promise<string>((res, rej) => {
            const fr = new FileReader();
            fr.onload = () => res(String(fr.result).split(",")[1] ?? "");
            fr.onerror = () => rej(fr.error);
            fr.readAsDataURL(blob);
          });
          await transcribeAction({ roomId, audioBase64, mime: rec.mimeType || "audio/webm" });
        } catch (e) {
          setError(`transcription failed: ${String(e).slice(0, 160)}`);
        }
      };
      recorderRef.current = rec;
      rec.start();
      setRecording(true);
    } catch (e) {
      setError(`Mic unavailable: ${String(e).slice(0, 160)}`);
    }
  }, [roomId, recording, transcribeAction]);

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
