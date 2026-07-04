# Optional local audio adapters

The MVP keeps voice I/O behind the room-state protocol. The first proof runs in the terminal because the hard problem is not audio capture; it is continuation without echo loops.

To add local audio:

1. ASR: run whisper.cpp `whisper-stream` and send final segments to `/voice/utterance`.
2. TTS: use Kokoro or Piper to synthesize each scheduled agent utterance.
3. VAD/barge-in: keep it separate from room state. VAD decides when speech started/stopped; the room reducer decides whether the content is a task action, backchannel, handoff, or correction.

The interface to preserve:

```ts
onTranscript({ actorId, text, ts }) -> applyUtterance(roomState, utterance)
onScheduledAgent(actorId) -> decideVoiceUtterance(roomState, agent)
onAgentUtterance(text) -> synthesize locally
```
