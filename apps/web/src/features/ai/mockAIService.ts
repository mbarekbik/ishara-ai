import { AIError, type AIService } from "./service";
import { fixtures } from "../../mocks/fixtures";
import { mockCapture, type MockOptions } from "../../mocks/capture";
export function createMockAIService(options: MockOptions = {}): AIService {
  return {
    kind: "mock",
    reply: ({ messages, responseLanguage, signal }) => {
      const latest = messages.at(-1);
      const language = responseLanguage !== "auto" ? responseLanguage : [...messages].reverse()
        .find((message) => message.speaker === latest?.speaker && /^(en|ar)(-|$)/i.test(message.language))?.language.split("-")[0].toLowerCase();
      if (language !== "en" && language !== "ar") return Promise.reject(new AIError("AI_LANGUAGE_REQUIRED"));
      return mockCapture(
        {
          text: fixtures[language === "ar" ? "ar" : "en"].ai[0],
          language,
          source: "mock",
        },
        signal,
        options,
      ).finish();
    },
  };
}
