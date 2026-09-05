import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, expect, test, vi } from "vitest";
import { useCamera } from "./useCamera";
function fakeStream() {
  const track = new EventTarget() as EventTarget & {
    stop: () => void;
    readyState: string;
  };
  track.stop = vi.fn();
  track.readyState = "live";
  const stream = {
    getTracks: () => [track],
    getVideoTracks: () => [track],
  } as unknown as MediaStream;
  return { stream, track };
}
beforeEach(() => vi.stubGlobal("isSecureContext", true));
test("requests video only, releases on hide, and stays off when visible again", async () => {
  const { stream, track } = fakeStream();
  const media = vi.fn().mockResolvedValue(stream);
  const release = vi.fn();
  vi.stubGlobal("navigator", { mediaDevices: { getUserMedia: media } });
  const { result } = renderHook(() => useCamera(release));
  expect(media).not.toHaveBeenCalled();
  await act(() => result.current.request());
  expect(media).toHaveBeenCalledWith({
    audio: false,
    video: {
      facingMode: "user",
      width: { ideal: 1280 },
      height: { ideal: 720 },
    },
  });
  expect(result.current.status).toBe("ready");
  vi.spyOn(document, "hidden", "get").mockReturnValue(true);
  act(() => document.dispatchEvent(new Event("visibilitychange")));
  expect(track.stop).toHaveBeenCalledOnce();
  expect(release).toHaveBeenCalled();
  expect(result.current.stream).toBeNull();
  vi.spyOn(document, "hidden", "get").mockReturnValue(false);
  act(() => document.dispatchEvent(new Event("visibilitychange")));
  expect(result.current.status).toBe("off");
  expect(media).toHaveBeenCalledOnce();
});
test("late permission resolution after unmount stops tracks without attaching them", async () => {
  let resolve!: (stream: MediaStream) => void;
  const { stream, track } = fakeStream();
  const release = vi.fn();
  vi.stubGlobal("navigator", {
    mediaDevices: {
      getUserMedia: () =>
        new Promise((done) => {
          resolve = done;
        }),
    },
  });
  const { result, unmount } = renderHook(() => useCamera(release));
  act(() => {
    void result.current.request();
  });
  unmount();
  await act(async () => {
    resolve(stream);
  });
  expect(track.stop).toHaveBeenCalledOnce();
});
test("cancelled permission request cannot replace a newer camera stream", async () => {
  let resolve!: (stream: MediaStream) => void;
  const old = fakeStream();
  const next = fakeStream();
  const release = vi.fn();
  const media = vi
    .fn()
    .mockImplementationOnce(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    )
    .mockResolvedValueOnce(next.stream);
  vi.stubGlobal("navigator", { mediaDevices: { getUserMedia: media } });
  const { result } = renderHook(() => useCamera(release));
  act(() => {
    void result.current.request();
  });
  act(() => result.current.stop());
  await act(() => result.current.request());
  await act(async () => {
    resolve(old.stream);
  });
  expect(old.track.stop).toHaveBeenCalledOnce();
  expect(next.track.stop).not.toHaveBeenCalled();
  expect(result.current.stream).toBe(next.stream);
});
test("track ending cancels the interaction and exposes a recoverable error", async () => {
  const { stream, track } = fakeStream();
  const release = vi.fn();
  vi.stubGlobal("navigator", {
    mediaDevices: { getUserMedia: vi.fn().mockResolvedValue(stream) },
  });
  const { result } = renderHook(() => useCamera(release));
  await act(() => result.current.request());
  act(() => track.dispatchEvent(new Event("ended")));
  expect(result.current.error).toBe("cameraEnded");
  expect(result.current.stream).toBeNull();
  expect(release).toHaveBeenCalledOnce();
});
test.each([
  ["NotAllowedError", "cameraDenied"],
  ["NotFoundError", "cameraMissing"],
  ["NotReadableError", "cameraBusy"],
])("maps %s to actionable guidance", async (name, code) => {
  vi.stubGlobal("navigator", {
    mediaDevices: {
      getUserMedia: vi.fn().mockRejectedValue(new DOMException("", name)),
    },
  });
  const release = vi.fn();
  const { result } = renderHook(() => useCamera(release));
  await act(() => result.current.request());
  await waitFor(() => expect(result.current.error).toBe(code));
});
test("unmount releases an active stream exactly once", async () => {
  const { stream, track } = fakeStream();
  const release = vi.fn();
  vi.stubGlobal("navigator", {
    mediaDevices: { getUserMedia: vi.fn().mockResolvedValue(stream) },
  });
  const { result, unmount } = renderHook(() => useCamera(release));
  await act(() => result.current.request());
  unmount();
  expect(track.stop).toHaveBeenCalledOnce();
});
test("insecure context never attempts camera access", async () => {
  vi.stubGlobal("isSecureContext", false);
  const media = vi.fn();
  const release = vi.fn();
  vi.stubGlobal("navigator", { mediaDevices: { getUserMedia: media } });
  const { result } = renderHook(() => useCamera(release));
  await act(() => result.current.request());
  expect(result.current.error).toBe("cameraUnsupported");
  expect(media).not.toHaveBeenCalled();
});
