import { beforeEach, expect, test, vi } from "vitest";
import { createGeminiLiveSpeechService, FINAL_SETTLE_MS, FINAL_DEADLINE_MS } from "./geminiLiveSpeechService";
import type { openGeminiLiveClient } from "./geminiLiveClient";
import type { createMicrophoneCapture } from "./microphoneCapture";
beforeEach(() => vi.useFakeTimers());
async function setup() {
  let socketInput!: Parameters<typeof openGeminiLiveClient>[0];
  let audioInput!: Parameters<typeof createMicrophoneCapture>[0];
  const mic = { start: vi.fn(), stop: vi.fn(async () => undefined), cancel: vi.fn() };
  const socket = { ready: Promise.resolve(), start: vi.fn(), sendAudio: vi.fn(), end: vi.fn(), close: vi.fn() };
  const token = vi.fn(async (language: string) => { void language; return {token:"auth_tokens/test", model:"gemini-3.5-transcribe-live" as const,apiVersion:"v1beta" as const,expiresAt:"unused",newSessionExpiresAt:"unused"}; });
  const service = createGeminiLiveSpeechService({
    capture: async (input) => { audioInput = input; return mic; }, token,
    connect: (input) => { socketInput = input; return socket; },
  });
  const controller = new AbortController();
  const onDraft = vi.fn(), onError = vi.fn();
  const operation = await service.begin({language:"ar",speechLanguage:"en",signal:controller.signal,onDraft,onError,onPhase:vi.fn()});
  return {operation,mic,socket,controller,onDraft,onError,token,observe:socketInput.onObservation,audio:audioInput.onAudio};
}
test("streams PCM, flushes before end, and returns only final segments once", async () => {
  const h = await setup();
  expect(h.token.mock.calls[0][0]).toBe("en");
  h.audio(new ArrayBuffer(3200), 16000); expect(h.socket.sendAudio).toHaveBeenCalled();
  h.observe({kind:"interim",text:"Hello"}); h.observe({kind:"final",text:"Hello.",language:"en-US"});
  const finished = h.operation.finish(); expect(h.operation.finish()).toBe(finished);
  expect(h.mic.stop).toHaveBeenCalledTimes(1); expect(h.socket.end).not.toHaveBeenCalled();
  await Promise.resolve(); expect(h.socket.end).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(1000);
  h.observe({kind:"final",text:"Another sentence.",language:"en-US"});
  const resolved = vi.fn(); void finished.then(resolved);
  await vi.advanceTimersByTimeAsync(FINAL_SETTLE_MS - 1); expect(resolved).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(1);
  expect(await finished).toEqual({text:"Hello. Another sentence.",language:"en-US",source:"service"});
  expect(h.socket.close).toHaveBeenCalled(); expect(h.mic.cancel).toHaveBeenCalled();
});
test("model completion and unresolved interim text never become a final transcript", async () => {
  const h = await setup(); h.observe({kind:"interim",text:"unfinished"});
  const pending = h.operation.finish(); const rejection = expect(pending).rejects.toThrow("LIVE_INCOMPLETE_TRANSCRIPT");
  await Promise.resolve(); h.observe({kind:"model-turn-complete"});
  await vi.advanceTimersByTimeAsync(FINAL_DEADLINE_MS); await rejection;
  expect(h.onError).toHaveBeenCalledWith("LIVE_INCOMPLETE_TRANSCRIPT");
});
test("cancel discards pending finals and closes all resources", async () => {
  const h = await setup(); const pending=h.operation.finish(); const rejection=expect(pending).rejects.toMatchObject({name:"AbortError"});
  h.controller.abort(); h.observe({kind:"final",text:"late"});
  await rejection; expect(h.onDraft).not.toHaveBeenCalled(); expect(h.mic.cancel).toHaveBeenCalled(); expect(h.socket.close).toHaveBeenCalled();
});
