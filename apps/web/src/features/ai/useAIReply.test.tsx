import { act, renderHook } from "@testing-library/react";
import { beforeEach, expect, test, vi } from "vitest";
import { useAIReply } from "./useAIReply";
import { AIError, type AIService, type ResponseLanguage } from "./service";
import { createMockAIService } from "./mockAIService";
import { useSessionStore } from "../communication/sessionStore";
import type { RecognitionResult } from "../communication/interaction";

let sessionId: string;
function human(id: string, text = "I have an appointment today.") {
  useSessionStore.getState().append(sessionId, { id, text, sender: { id: "participant-2", kind: "human" }, inputType: "sign", source: "mock", language: "en", createdAt: "2026-09-06T00:00:00Z" });
}
beforeEach(() => {
  vi.useFakeTimers();
  useSessionStore.setState({ session: null });
  useSessionStore.getState().ensureSession();
  sessionId = useSessionStore.getState().session!.id;
  human("first");
});
function pending() {
  let resolve!: (result: RecognitionResult) => void;
  const reply = vi.fn<AIService["reply"]>().mockReturnValue(new Promise((settle) => { resolve = settle; }));
  const service: AIService = { kind: "service", reply };
  return { service, reply, resolve };
}
const output: RecognitionResult = { text: "What would you like to explain?", language: "en", source: "service" };

test("duplicate Ask snapshots text once and commits one assistant with no extra data", async () => {
  const fixture = pending();
  const { result } = renderHook(() => useAIReply(fixture.service, sessionId, "en"));
  act(() => { void result.current.start(); void result.current.start(); });
  expect(fixture.reply).toHaveBeenCalledTimes(1);
  expect(fixture.reply.mock.calls[0][0].messages).toEqual([{ speaker: "participant-2", text: "I have an appointment today.", language: "en", source: "mock" }]);
  expect(useSessionStore.getState().session!.messages).toHaveLength(1);
  await act(async () => fixture.resolve(output));
  const messages = useSessionStore.getState().session!.messages;
  expect(messages).toHaveLength(2);
  expect(messages[1]).toMatchObject({ sender: { id: "assistant", kind: "assistant" }, inputType: "ai", source: "service", text: output.text });
  expect(result.current.status).toBe("success");
  expect(result.current.eligible).toBe(false);
  await act(async () => result.current.start());
  expect(fixture.reply).toHaveBeenCalledTimes(1);
});
test("a new completed message invalidates pending AI in the same session", async () => {
  const fixture = pending();
  const { result } = renderHook(() => useAIReply(fixture.service, sessionId, "auto"));
  act(() => { void result.current.start(); });
  act(() => human("next", "On the left side."));
  expect(fixture.reply.mock.calls[0][0].signal.aborted).toBe(true);
  expect(result.current.error?.code).toBe("AI_CONVERSATION_CHANGED");
  await act(async () => fixture.resolve(output));
  expect(useSessionStore.getState().session!.messages.map((item) => item.id)).toEqual(["first", "next"]);
});
test.each(["cancel", "reset", "unmount", "hidden", "pagehide"] as const)("%s releases operation and ignores late adapter resolution", async (method) => {
  const fixture = pending();
  const { result, unmount } = renderHook(() => useAIReply(fixture.service, sessionId, "en"));
  act(() => { void result.current.start(); });
  act(() => {
    if (method === "cancel") result.current.cancel();
    if (method === "reset") useSessionStore.getState().reset();
    if (method === "unmount") unmount();
    if (method === "hidden") { vi.spyOn(document, "hidden", "get").mockReturnValue(true); document.dispatchEvent(new Event("visibilitychange")); }
    if (method === "pagehide") window.dispatchEvent(new Event("pagehide"));
  });
  await act(async () => fixture.resolve(output));
  expect(fixture.reply.mock.calls[0][0].signal.aborted).toBe(true);
  expect(useSessionStore.getState().session!.messages.some((message) => message.inputType === "ai")).toBe(false);
  expect(vi.getTimerCount()).toBe(0);
});
test.each([new AIError("AI_DECLINED"), new AIError("AI_UPSTREAM_UNAVAILABLE", true)])("provider errors preserve history and remain recoverable: %s", async (failure) => {
  const service: AIService = { kind: "service", reply: vi.fn().mockRejectedValue(failure) };
  const { result } = renderHook(() => useAIReply(service, sessionId, "en"));
  await act(async () => result.current.start());
  expect(result.current.status).toBe("error");
  expect(result.current.error?.code).toBe(failure.code);
  expect(result.current.eligible).toBe(true);
  expect(useSessionStore.getState().session!.messages).toHaveLength(1);
});
test.each([{ ...output, text: "" }, { ...output, source: "mock" as const }, { ...output, language: "ar" }])("injected invalid output cannot bypass commit validation", async (response) => {
  const service: AIService = { kind: "service", reply: vi.fn().mockResolvedValue(response) };
  const { result } = renderHook(() => useAIReply(service, sessionId, "en"));
  await act(async () => result.current.start());
  expect(result.current.error?.code).toBe("AI_INVALID_RESPONSE");
  expect(useSessionStore.getState().session!.messages).toHaveLength(1);
});
test("response language is captured at start and never inferred from later UI rerenders", async () => {
  const fixture = pending();
  const { result, rerender } = renderHook(({ language }: { language: ResponseLanguage }) => useAIReply(fixture.service, sessionId, language), { initialProps: { language: "en" } });
  act(() => { void result.current.start(); });
  rerender({ language: "ar" });
  await act(async () => fixture.resolve(output));
  expect(fixture.reply.mock.calls[0][0].responseLanguage).toBe("en");
  expect(useSessionStore.getState().session!.messages.at(-1)?.language).toBe("en");
});
test("deadline settles even for an adapter ignoring cancellation", async () => {
  const fixture = pending();
  const { result } = renderHook(() => useAIReply(fixture.service, sessionId, "en"));
  act(() => { void result.current.start(); });
  await act(async () => vi.advanceTimersByTimeAsync(25_000));
  expect(result.current.error?.code).toBe("AI_TIMEOUT");
  await act(async () => fixture.resolve(output));
  expect(useSessionStore.getState().session!.messages).toHaveLength(1);
});
test("explicit Demo is device/backend-free and uses message language for Auto", async () => {
  const fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher);
  const { result } = renderHook(() => useAIReply(createMockAIService({ delayMs: 20 }), sessionId, "auto"));
  act(() => { void result.current.start(); });
  await act(async () => vi.advanceTimersByTimeAsync(20));
  expect(useSessionStore.getState().session!.messages.at(-1)).toMatchObject({ source: "mock", language: "en", inputType: "ai" });
  expect(fetcher).not.toHaveBeenCalled();
});
