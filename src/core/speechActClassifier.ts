import type { ClassifiedUtterance, RoomState, SpeechAct, Utterance } from "./types.js";
import { extractNumber } from "./numberWords.js";

const ACK_PATTERNS = [
  /\byeah\b/i,
  /\byah\b/i,
  /\byep\b/i,
  /\byup\b/i,
  /\bexactly\b/i,
  /\bagree\b/i,
  /\bsounds good\b/i,
  /\blet'?s do that\b/i,
  /\bgreat\b/i,
  /\bokay\b/i,
];

const HANDOFF_PATTERNS = [/\byour turn\b/i, /\byou continue\b/i, /\bcontinue from\b/i, /\bwhere i leave off\b/i, /\bover to\b/i];
const INSTRUCTION_PATTERNS = [/\bcount from\b/i, /\bcount to\b/i, /\bgoal\b/i, /\btask\b/i, /\bwe need to\b/i, /\bplease\b/i];
const CORRECTION_PATTERNS = [/\bwrong\b/i, /\bactually\b/i, /\bcorrection\b/i, /\bnot that\b/i];
const SUMMARY_PATTERNS = [/\bin summary\b/i, /\bto summarize\b/i, /\brecap\b/i];

export function classifyUtterance(utterance: Utterance, state: RoomState): ClassifiedUtterance {
  const text = utterance.text.trim();
  const extractedNumber = extractNumber(text);
  const speechAct = pickSpeechAct(text, extractedNumber, state);
  const reason = reasonFor(text, speechAct, extractedNumber);
  const confidence = confidenceFor(text, speechAct, extractedNumber);

  return {
    ...utterance,
    speechAct,
    extractedNumber,
    reason,
    confidence,
  };
}

function pickSpeechAct(text: string, extractedNumber: number | undefined, state: RoomState): SpeechAct {
  const isShort = text.split(/\s+/).filter(Boolean).length <= 5;
  const isAck = ACK_PATTERNS.some((pattern) => pattern.test(text));
  const isHandoff = HANDOFF_PATTERNS.some((pattern) => pattern.test(text));
  const isInstruction = INSTRUCTION_PATTERNS.some((pattern) => pattern.test(text));
  const isCorrection = CORRECTION_PATTERNS.some((pattern) => pattern.test(text));
  const isSummary = SUMMARY_PATTERNS.some((pattern) => pattern.test(text));

  if (text.startsWith("ARTIFACT_PATCH:")) return "artifact_patch";
  if (isCorrection) return "correction";
  if (isSummary) return "summary";
  if (extractedNumber !== undefined) {
    const countTask = state.task.kind === "count_to_n" ? state.task : undefined;
    if (!countTask) return "task_action";
    const expected = countTask.next;
    if (extractedNumber === expected || extractedNumber === countTask.current) return "task_action";
    if (isInstruction) return "instruction";
    return "task_action";
  }
  if (isHandoff) return "handoff";
  if (isAck && isShort) return "backchannel";
  if (isAck && !isInstruction) return "backchannel";
  if (isInstruction) return "instruction";
  if (/\?\s*$/.test(text)) return "clarification";
  return "task_action";
}

function reasonFor(text: string, speechAct: SpeechAct, extractedNumber: number | undefined): string {
  if (speechAct === "backchannel") return "acknowledgement phrase without a concrete task mutation";
  if (speechAct === "task_action" && extractedNumber !== undefined) return `numeric contribution detected: ${extractedNumber}`;
  if (speechAct === "handoff") return "handoff phrase detected";
  if (speechAct === "instruction") return "instructional phrase detected";
  if (speechAct === "artifact_patch") return "structured artifact patch marker detected";
  return `classified by deterministic rule as ${speechAct}`;
}

function confidenceFor(text: string, speechAct: SpeechAct, extractedNumber: number | undefined): number {
  if (speechAct === "task_action" && extractedNumber !== undefined) return 0.98;
  if (speechAct === "backchannel") return 0.9;
  if (speechAct === "artifact_patch") return 0.99;
  if (text.length < 4) return 0.55;
  return 0.75;
}
