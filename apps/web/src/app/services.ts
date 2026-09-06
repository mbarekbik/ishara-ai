import { createMockSignService } from "../features/sign/mockSignService";
import { createMockSpeechService } from "../features/voice/mockSpeechService";
import { createMockAIService } from "../features/ai/mockAIService";
import { createGeminiLiveSpeechService } from "../features/voice/geminiLiveSpeechService";
import type { SpeechService } from "../features/voice/service";
// One composition point; create fresh adapters for each session.
export function createServices(): Services {
  return {
    sign: createMockSignService(),
    speech: createMockSpeechService(),
    realSpeech: createGeminiLiveSpeechService(),
    ai: createMockAIService(),
  };
}
export interface Services {
  sign: ReturnType<typeof createMockSignService>;
  speech: SpeechService;
  realSpeech?: SpeechService;
  ai: ReturnType<typeof createMockAIService>;
}
