import { act, renderHook } from "@testing-library/react";
import { beforeEach, expect, test, vi } from "vitest";
import { useLandmarkTracking } from "./useLandmarkTracking";
import { startFrameScheduler } from "./frameScheduler";
import { TrackingError, type LandmarkFrame } from "./model";
import type { LandmarkTracker } from "./service";

vi.mock("./frameScheduler", () => ({ startFrameScheduler: vi.fn(() => vi.fn()) }));
beforeEach(() => { vi.clearAllMocks(); vi.useFakeTimers(); vi.spyOn(document, "hidden", "get").mockReturnValue(false); });
function video(ready = true) {
  const node = document.createElement("video");
  Object.defineProperties(node, { readyState: { value: ready ? 2 : 0, configurable: true }, videoWidth: { value: ready ? 640 : 0, configurable: true }, videoHeight: { value: ready ? 480 : 0, configurable: true } });
  return node;
}
function services() {
  const tracker: LandmarkTracker = { initialize: vi.fn().mockResolvedValue(undefined), detect: vi.fn(), dispose: vi.fn().mockResolvedValue(undefined) };
  return { tracker, createTracker: vi.fn(() => tracker) };
}
const flush = () => act(async () => { await Promise.resolve(); await Promise.resolve(); });
const frame: LandmarkFrame = { schemaVersion: 1, topology: "human-553-v1", trackingRunId: "run", sequence: 1, timestampMs: 20, source: { width: 640, height: 480, mirrored: false }, pose: null, face: null, leftHand: null, rightHand: null };

test("waits for decoded dimensions, loads once, and keeps landmark frames outside React state", async () => {
  const node = video(false); const { tracker, createTracker } = services(); const listener = vi.fn();
  const { result, rerender, unmount } = renderHook(() => useLandmarkTracking({ video: node, createTracker, onLandmarkFrame: listener }));
  await flush(); expect(createTracker).not.toHaveBeenCalled(); expect(result.current.status).toBe("loading");
  Object.defineProperties(node, { readyState: { value: 2 }, videoWidth: { value: 640 }, videoHeight: { value: 480 } });
  act(() => node.dispatchEvent(new Event("loadeddata"))); await flush();
  expect(tracker.initialize).toHaveBeenCalledOnce(); expect(result.current.status).toBe("ready");
  act(() => vi.mocked(startFrameScheduler).mock.calls[0][0].onFrame(frame));
  expect(result.current.status).toBe("tracking"); expect(result.current.frameRef.current).toBe(frame); expect(listener).toHaveBeenCalledWith(frame);
  rerender(); await flush(); expect(createTracker).toHaveBeenCalledOnce();
  unmount(); expect(tracker.dispose).toHaveBeenCalledOnce();
});
test("pause stays paused across renders; resume waits for disposal and starts a fresh run", async () => {
  const node = video(); const { tracker, createTracker } = services();
  const { result, rerender } = renderHook(() => useLandmarkTracking({ video: node, createTracker })); await flush();
  const old = vi.mocked(startFrameScheduler).mock.calls[0][0];
  act(() => old.onFrame(frame));
  act(() => result.current.pause()); expect(result.current.frameRef.current).toBeNull();
  rerender(); await flush(); expect(result.current.status).toBe("paused"); expect(createTracker).toHaveBeenCalledOnce();
  act(() => old.onFrame(frame)); expect(result.current.frameRef.current).toBeNull();
  act(() => result.current.resume()); await flush(); expect(createTracker).toHaveBeenCalledTimes(2);
  expect(vi.mocked(tracker.initialize).mock.calls[0][0]).not.toBe(vi.mocked(tracker.initialize).mock.calls[1][0]);
});
test("unmount while initialization is pending aborts and ignores its late completion", async () => {
  const node = video(); const { tracker, createTracker } = services(); let ready!: () => void;
  vi.mocked(tracker.initialize).mockImplementation(() => new Promise<void>(resolve => { ready = resolve; }));
  const { unmount } = renderHook(() => useLandmarkTracking({ video: node, createTracker })); await flush();
  const signal = vi.mocked(tracker.initialize).mock.calls[0][1]; unmount();
  expect(signal.aborted).toBe(true); expect(tracker.dispose).toHaveBeenCalledOnce();
  await act(async () => ready()); expect(startFrameScheduler).not.toHaveBeenCalled();
});
test("hidden page releases tracking; becoming visible never restarts automatically", async () => {
  const node = video(); const { tracker, createTracker } = services();
  const { result } = renderHook(() => useLandmarkTracking({ video: node, createTracker })); await flush();
  vi.spyOn(document, "hidden", "get").mockReturnValue(true);
  act(() => document.dispatchEvent(new Event("visibilitychange"))); expect(result.current.status).toBe("idle");
  vi.spyOn(document, "hidden", "get").mockReturnValue(false);
  act(() => document.dispatchEvent(new Event("visibilitychange"))); await flush();
  expect(createTracker).toHaveBeenCalledOnce(); expect(tracker.dispose).toHaveBeenCalledOnce();
});
test("failure stops and clears tracking without silently restarting; retry is explicit", async () => {
  const node = video(); const { tracker, createTracker } = services();
  const { result, rerender } = renderHook(() => useLandmarkTracking({ video: node, createTracker })); await flush();
  const callbacks = vi.mocked(startFrameScheduler).mock.calls[0][0];
  act(() => callbacks.onFrame(frame)); act(() => callbacks.onError("trackingInferenceFailed"));
  expect(result.current.error).toBe("trackingInferenceFailed"); expect(result.current.frameRef.current).toBeNull();
  rerender(); await flush(); expect(createTracker).toHaveBeenCalledOnce(); expect(tracker.dispose).toHaveBeenCalledOnce();
  act(() => result.current.retry()); await flush(); expect(createTracker).toHaveBeenCalledTimes(2);
});
test("missing decoded video times out without creating a detector and clears its listeners", async () => {
  const node = video(false); const { createTracker } = services();
  const { result } = renderHook(() => useLandmarkTracking({ video: node, createTracker })); await flush();
  await act(() => vi.advanceTimersByTimeAsync(10_000));
  expect(result.current.error).toBe("trackingVideoUnavailable"); expect(createTracker).not.toHaveBeenCalled();
  expect(vi.getTimerCount()).toBe(0);
});
test("initialization rejection becomes a stable localized error code", async () => {
  const node = video(); const { tracker, createTracker } = services();
  vi.mocked(tracker.initialize).mockRejectedValue(new TrackingError("trackingAssetsUnavailable"));
  const { result } = renderHook(() => useLandmarkTracking({ video: node, createTracker })); await flush();
  expect(result.current.error).toBe("trackingAssetsUnavailable"); expect(startFrameScheduler).not.toHaveBeenCalled();
});
