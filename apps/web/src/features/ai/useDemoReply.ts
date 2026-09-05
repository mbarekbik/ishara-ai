import type { AIService } from "./service";
import { useCaptureInteraction } from "../communication/useCaptureInteraction";
import { useSessionStore } from "../communication/sessionStore";
export function useDemoReply(
  service: AIService,
  sessionId: string,
  language: string,
) {
  return useCaptureInteraction({
    sessionId,
    sender: { id: "assistant", kind: "assistant" },
    language,
    inputType: "ai",
    phase: "processing",
    autoFinish: true,
    begin: async (language, signal) => {
      const messages = [
        ...(useSessionStore.getState().session?.messages ?? []),
      ];
      return {
        finish: () => service.reply({ messages, language, signal }),
        cancel: () => {},
      };
    },
  });
}
