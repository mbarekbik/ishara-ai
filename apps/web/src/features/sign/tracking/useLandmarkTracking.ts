import { useCallback, useEffect, useRef, useState } from "react";
import { TrackingError, type LandmarkFrame, type LandmarkFrameListener, type TrackingErrorCode, type TrackingStatus } from "./model";
import type { LandmarkTracker, LandmarkTrackerFactory } from "./service";
import { startFrameScheduler } from "./frameScheduler";

function waitForVideo(video: HTMLVideoElement, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const events = ["loadeddata", "canplay", "playing", "resize"];
    const clear = () => {
      clearTimeout(timer);
      events.forEach((event) => video.removeEventListener(event, check));
      video.removeEventListener("error", failure);
      signal.removeEventListener("abort", abort);
    };
    const check = () => {
      if (video.readyState >= 2 && video.videoWidth > 0 && video.videoHeight > 0) { clear(); resolve(); }
    };
    const failure = () => { clear(); reject(new TrackingError("trackingVideoUnavailable")); };
    const abort = () => { clear(); reject(new DOMException("Cancelled", "AbortError")); };
    const timer = setTimeout(failure, 10_000);
    events.forEach((event) => video.addEventListener(event, check));
    video.addEventListener("error", failure);
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) abort(); else check();
  });
}
interface Run {
  controller: AbortController;
  tracker?: LandmarkTracker;
  stopScheduling?: () => void;
}
export interface TrackingOptions {
  video: HTMLVideoElement | null;
  createTracker?: LandmarkTrackerFactory;
  onLandmarkFrame?: LandmarkFrameListener;
}
export function useLandmarkTracking({ video, createTracker, onLandmarkFrame }: TrackingOptions) {
  const [status, setStatus] = useState<TrackingStatus>("idle");
  const [error, setError] = useState<TrackingErrorCode | null>(null);
  const frameRef = useRef<LandmarkFrame | null>(null);
  const runRef = useRef<Run | null>(null);
  const callback = useRef(onLandmarkFrame);
  useEffect(() => { callback.current = onLandmarkFrame; }, [onLandmarkFrame]);
  const disposal = useRef<Promise<void>>(Promise.resolve());
  const release = useCallback(() => {
    const run = runRef.current;
    runRef.current = null;
    frameRef.current = null;
    if (run) {
      run.stopScheduling?.();
      run.controller.abort();
      const closing = run.tracker?.dispose() ?? Promise.resolve();
      disposal.current = Promise.all([disposal.current, closing]).then(() => {}).catch(() => {});
    }
    return disposal.current;
  }, []);
  const stop = useCallback(() => { void release(); setStatus("idle"); setError(null); }, [release]);
  const pause = useCallback(() => { void release(); setStatus("paused"); setError(null); }, [release]);
  const start = useCallback(() => {
    if (!video || document.hidden || runRef.current) return;
    const run: Run = { controller: new AbortController() };
    runRef.current = run;
    frameRef.current = null;
    setError(null); setStatus("loading");
    const current = () => runRef.current === run && !run.controller.signal.aborted;
    const fail = (code: TrackingErrorCode) => {
      if (!current()) return;
      void release(); setError(code); setStatus("error");
    };
    void (async () => {
      try {
        await disposal.current;
        if (!current()) return;
        await waitForVideo(video, run.controller.signal);
        if (!current()) return;
        if (!createTracker) throw new TrackingError("trackingUnsupported");
        const tracker = createTracker();
        run.tracker = tracker;
        const trackingRunId = crypto.randomUUID();
        await tracker.initialize(trackingRunId, run.controller.signal);
        if (!current()) { await tracker.dispose(); return; }
        setStatus("ready");
        let first = true;
        run.stopScheduling = startFrameScheduler({
          video, tracker, trackingRunId,
          onFrame: (frame) => {
            if (!current()) return;
            frameRef.current = frame;
            if (first) { first = false; setStatus("tracking"); }
            callback.current?.(frame);
          },
          onClear: () => { if (current()) frameRef.current = null; },
          onError: fail,
        });
      } catch (cause) {
        if (current()) fail(cause instanceof TrackingError ? cause.code : "trackingInitializationFailed");
      }
    })();
  }, [video, createTracker, release]);
  useEffect(() => {
    if (video) start(); else { setStatus("idle"); setError(null); }
    // This cleanup is independent of useCamera's onRelease callback.
    return () => { void release(); };
  }, [video, start, release]);
  useEffect(() => {
    const hidden = () => { if (document.hidden) stop(); };
    document.addEventListener("visibilitychange", hidden);
    window.addEventListener("pagehide", stop);
    return () => {
      document.removeEventListener("visibilitychange", hidden);
      window.removeEventListener("pagehide", stop);
    };
  }, [stop]);
  return { status, error, frameRef, stop, pause, resume: start, retry: start };
}
