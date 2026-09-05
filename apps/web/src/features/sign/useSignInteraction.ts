import type { SignRecognitionService } from "./service";
import { useCaptureInteraction } from "../communication/useCaptureInteraction";
export function useSignInteraction(
  service: SignRecognitionService,
  sessionId: string,
  senderId: string,
  language: string,
  video: () => HTMLVideoElement | null,
) {
  return useCaptureInteraction({
    sessionId,
    sender: { id: senderId, kind: "human" },
    language,
    inputType: "sign",
    phase: "capturing",
    begin: (language, signal) =>
      service.begin({ video: video(), language, signal }),
  });
}
