import type { SignRecognitionService } from "./service";
import { fixtures } from "../../mocks/fixtures";
import { mockCapture, type MockOptions } from "../../mocks/capture";
export function createMockSignService(
  options: MockOptions = {},
): SignRecognitionService {
  let index = 0;
  return {
    async begin({ language, signal }) {
      const phrases = fixtures[language === "ar" ? "ar" : "en"].sign;
      return mockCapture(
        { text: phrases[index++ % phrases.length], language, source: "mock" },
        signal,
        options,
      );
    },
  };
}
