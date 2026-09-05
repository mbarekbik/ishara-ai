import type { SpeechService } from "./service";
import { useCaptureInteraction } from "../communication/useCaptureInteraction";
export function useVoiceInteraction(
  service: SpeechService,
  sessionId: string,
  senderId: string,
  language: string,
) {
  return useCaptureInteraction({
    sessionId,
    sender: { id: senderId, kind: "human" },
    language,
    inputType: "voice",
    phase: "listening",
    begin: (language, signal) => service.begin({ language, signal }),
  });
}
