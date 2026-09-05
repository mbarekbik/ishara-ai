import type { AIService } from "./service";
import { fixtures } from "../../mocks/fixtures";
import { mockCapture, type MockOptions } from "../../mocks/capture";
export function createMockAIService(options: MockOptions = {}): AIService {
  return {
    reply: ({ language, signal }) =>
      mockCapture(
        {
          text: fixtures[language === "ar" ? "ar" : "en"].ai[0],
          language,
          source: "mock",
        },
        signal,
        options,
      ).finish(),
  };
}
