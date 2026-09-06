import { act, renderHook } from "@testing-library/react";
import { beforeEach, expect, test, vi } from "vitest";
import { useVoiceInteraction } from "./useVoiceInteraction";
import { useSessionStore } from "../communication/sessionStore";
import type { SpeechService } from "./service";
import type { RecognitionResult } from "../communication/interaction";
beforeEach(() => { vi.useFakeTimers(); useSessionStore.getState().reset(); });
function setup() {
  let input!: Parameters<SpeechService['begin']>[0];
  let resolve!: (result: RecognitionResult) => void;
  const cancel = vi.fn();
  const finish = vi.fn(() => new Promise<RecognitionResult>((done) => { resolve = done; }));
  const service: SpeechService = { kind: "service", begin: vi.fn(async (value) => { input = value; value.onPhase("listening"); return { cancel, finish }; }) };
  const id = useSessionStore.getState().session!.id;
  const hook = renderHook(() => useVoiceInteraction(service, id, "participant-1", "auto", "ar"));
  return { ...hook, service, cancel, finish, input: () => input, resolve: (text = "Actual test speech") => resolve({text, language: "en-US", source: "service"}) };
}
test("drafts stay local; one completed turn keeps sender and provider language", async () => {
  const h = setup();
  await act(async () => { await h.result.current.start(); await h.result.current.start(); });
  expect(h.service.begin).toHaveBeenCalledTimes(1);
  expect(h.input().speechLanguage).toBe("auto");
  act(() => h.input().onDraft({ finalText: "First segment", interimText: "still speaking", language: "en-US" }));
  expect(useSessionStore.getState().session!.messages).toHaveLength(0);
  let stopping!: Promise<void>;
  act(() => { stopping = h.result.current.stop(); void h.result.current.stop(); });
  expect(h.finish).toHaveBeenCalledTimes(1);
  await act(async () => { h.resolve(); await stopping; });
  expect(useSessionStore.getState().session!.messages).toHaveLength(1);
  expect(useSessionStore.getState().session!.messages[0]).toMatchObject({source:"service",inputType:"voice",language:"en-US",sender:{id:"participant-1"}});
  expect(h.result.current.status).toBe("success");
  expect(h.cancel).toHaveBeenCalledTimes(1);
});
test.each(["cancel", "reset", "unmount", "hidden"])("%s prevents stale completion and releases work", async (action) => {
  const h = setup(); await act(async () => h.result.current.start());
  let pending!: Promise<void>; act(() => { pending = h.result.current.stop(); });
  act(() => {
    if (action === "cancel") h.result.current.cancel();
    if (action === "reset") useSessionStore.getState().reset();
    if (action === "unmount") h.unmount();
    if (action === "hidden") { vi.spyOn(document,"hidden","get").mockReturnValue(true); document.dispatchEvent(new Event("visibilitychange")); }
  });
  await act(async () => { h.resolve(); await pending; });
  expect(useSessionStore.getState().session!.messages).toHaveLength(0);
  expect(h.input().signal.aborted).toBe(true);
  expect(h.cancel).toHaveBeenCalledTimes(1);
});
test("provider failure clears draft without committing or substituting a mock", async () => {
  const h = setup(); await act(async () => h.result.current.start());
  act(() => h.input().onError("LIVE_CONNECTION_CLOSED"));
  expect(h.result.current.error).toBe("LIVE_CONNECTION_CLOSED");
  expect(h.result.current.busy).toBe(false);
  expect(useSessionStore.getState().session!.messages).toHaveLength(0);
  expect(h.cancel).toHaveBeenCalled();
});
test("120 seconds automatically invokes finish", async () => {
  const h = setup(); await act(async () => h.result.current.start());
  await act(async () => vi.advanceTimersByTimeAsync(120_000));
  expect(h.finish).toHaveBeenCalledTimes(1);
  await act(async () => { h.resolve(); await Promise.resolve(); });
  expect(useSessionStore.getState().session!.messages).toHaveLength(1);
});
