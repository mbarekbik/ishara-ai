import { createMockSignService } from "../features/sign/mockSignService";
import { createMockSpeechService } from "../features/voice/mockSpeechService";
import { createMockAIService } from "../features/ai/mockAIService";
// One composition point; create fresh adapters for each session.
export function createServices() {
  return {
    sign: createMockSignService(),
    speech: createMockSpeechService(),
    ai: createMockAIService(),
  };
}
export type Services = ReturnType<typeof createServices>;
