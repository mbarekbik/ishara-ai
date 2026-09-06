import type { TranscriptDraft } from "./service";
import type { ProtocolObservation } from "./geminiLiveClient";
export function createTranscriptAccumulator() {
  const segments: string[] = [];
  const languages = new Set<string>();
  let interimText = "";
  return {
    accept(event: ProtocolObservation) {
      if (event.kind === "model-turn-complete") return;
      if (event.kind === "interim") interimText = event.text;
      else {
        if (event.text.trim()) { segments.push(event.text.trim()); languages.add(event.language || "und"); }
        interimText = "";
      }
    },
    snapshot(): TranscriptDraft {
      return { finalText: segments.join(" "), interimText, language: languages.size > 1 ? "mul" : [...languages][0] ?? "und" };
    },
  };
}
