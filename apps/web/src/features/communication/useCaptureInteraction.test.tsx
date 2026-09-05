import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, expect, test, vi } from "vitest";
import { useCaptureInteraction } from "./useCaptureInteraction";
import { useSessionStore } from "./sessionStore";
import type { CaptureOperation, RecognitionResult } from "./interaction";
const output: RecognitionResult = {
  text: "Hello",
  language: "en",
  source: "mock",
};
beforeEach(() => useSessionStore.getState().reset());
function setup(begin: () => Promise<CaptureOperation>) {
  return renderHook(
    ({ language }) =>
      useCaptureInteraction({
        sessionId: useSessionStore.getState().session!.id,
        sender: { id: "participant-1", kind: "human" },
        language,
        inputType: "sign",
        phase: "capturing",
        begin,
      }),
    { initialProps: { language: "en" } },
  );
}
test("rapid start/finish actions call the adapter once and append exactly once", async () => {
  const finish = vi.fn().mockResolvedValue(output);
  const begin = vi.fn().mockResolvedValue({ finish, cancel: vi.fn() });
  const { result } = setup(begin);
  await act(async () => {
    await Promise.all([result.current.start(), result.current.start()]);
  });
  await act(async () => {
    await Promise.all([result.current.finish(), result.current.finish()]);
  });
  expect(begin).toHaveBeenCalledOnce();
  expect(finish).toHaveBeenCalledOnce();
  expect(useSessionStore.getState().session!.messages).toHaveLength(1);
});
test("Stop requested before begin resolves still finalizes once ready", async () => {
  let resolve!: (operation: CaptureOperation) => void;
  const finish = vi.fn().mockResolvedValue(output);
  const { result } = setup(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  act(() => {
    void result.current.start();
  });
  await act(() => result.current.finish());
  expect(result.current.status).toBe("processing");
  await act(async () => {
    resolve({ finish, cancel: vi.fn() });
  });
  expect(finish).toHaveBeenCalledOnce();
  expect(useSessionStore.getState().session!.messages).toHaveLength(1);
});
test.each(["cancel", "unmount", "reset"] as const)(
  "%s blocks a late provider result even if it ignores AbortSignal",
  async (action) => {
    let resolve!: (value: RecognitionResult) => void;
    const cancel = vi.fn();
    const { result, unmount } = setup(async () => ({
      cancel,
      finish: () =>
        new Promise((done) => {
          resolve = done;
        }),
    }));
    await act(() => result.current.start());
    act(() => {
      void result.current.finish();
    });
    if (action === "cancel") act(() => result.current.cancel());
    else if (action === "unmount") unmount();
    else act(() => useSessionStore.getState().reset());
    await act(async () => {
      resolve(output);
    });
    expect(useSessionStore.getState().session!.messages).toHaveLength(0);
    expect(cancel).toHaveBeenCalled();
  },
);
test("cancels a begin operation that resolves after unmount", async () => {
  let resolve!: (operation: CaptureOperation) => void;
  const cancel = vi.fn();
  const { result, unmount } = setup(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  act(() => {
    void result.current.start();
  });
  unmount();
  await act(async () => {
    resolve({ cancel, finish: vi.fn() });
  });
  expect(cancel).toHaveBeenCalledOnce();
  expect(useSessionStore.getState().session!.messages).toHaveLength(0);
});
test("a rejected begin is recoverable", async () => {
  const { result } = setup(async () => {
    throw new Error("Unavailable");
  });
  await act(() => result.current.start());
  await waitFor(() => expect(result.current.error).toBe("serviceError"));
  expect(result.current.busy).toBe(false);
  expect(useSessionStore.getState().session!.messages).toHaveLength(0);
});
