import { TrackingError, type LandmarkFrame, type TrackingErrorCode } from './model';
import type { LandmarkTracker } from './service';

interface Options {
  video: HTMLVideoElement;
  tracker: LandmarkTracker;
  trackingRunId: string;
  onFrame: (frame: LandmarkFrame) => void;
  onError: (code: TrackingErrorCode) => void;
  onClear: () => void;
}
interface Dependencies {
  now?: () => number;
  createBitmap?: (video: HTMLVideoElement, options: ImageBitmapOptions) => Promise<ImageBitmap>;
  requestAnimationFrame?: (callback: FrameRequestCallback) => number;
  cancelAnimationFrame?: (handle: number) => void;
}

/** No queue and no camera ownership. The caller owns tracker initialization/disposal. */
export function startFrameScheduler(options: Options, dependencies: Dependencies = {}): () => void {
  const { video, tracker, trackingRunId, onFrame, onError, onClear } = options;
  const now = dependencies.now ?? (() => performance.now());
  const createBitmap = dependencies.createBitmap ?? ((source, resize) => createImageBitmap(source, resize));
  const requestAnimation = dependencies.requestAnimationFrame ?? requestAnimationFrame;
  const cancelAnimation = dependencies.cancelAnimationFrame ?? cancelAnimationFrame;
  const useVideoCallbacks = typeof video.requestVideoFrameCallback === 'function';
  let stopped = false;
  let busy = false;
  let scheduled: number | null = null;
  let watchdog: ReturnType<typeof setTimeout> | undefined;
  let expiry: ReturnType<typeof setTimeout> | undefined;
  let sourceWidth = video.videoWidth;
  let sourceHeight = video.videoHeight;
  let geometryRevision = 0;
  let sequence = 0;
  let lastSubmittedAt = -Infinity;
  let lastSubmittedTimestamp = -Infinity;
  let lastObservedTimestamp = -Infinity;
  let lastFreshAt: number | null = null;
  let firstCompletedAt: number | null = null;

  function clearOverlay() { clearTimeout(expiry); expiry = undefined; onClear(); }
  function stop() {
    if (stopped) return;
    stopped = true;
    if (scheduled !== null) {
      if (useVideoCallbacks) video.cancelVideoFrameCallback(scheduled);
      else cancelAnimation(scheduled);
    }
    scheduled = null;
    clearTimeout(watchdog); watchdog = undefined;
    video.removeEventListener('resize', synchronizeGeometry);
    clearOverlay();
  }
  function fail(code: TrackingErrorCode) {
    if (stopped) return;
    stop();
    onError(code);
  }
  function synchronizeGeometry() {
    if (video.videoWidth === sourceWidth && video.videoHeight === sourceHeight) return;
    sourceWidth = video.videoWidth; sourceHeight = video.videoHeight;
    geometryRevision += 1;
    clearOverlay();
  }

  async function process(timestampMs: number, submittedAt: number) {
    // Set before createImageBitmap: its asynchronous work is also part of the one-frame budget.
    busy = true;
    lastSubmittedAt = submittedAt;
    lastSubmittedTimestamp = timestampMs;
    const revision = geometryRevision;
    const source = { width: sourceWidth, height: sourceHeight, mirrored: false as const };
    const submittedSequence = ++sequence;
    const scale = Math.min(1, 960 / Math.max(source.width, source.height));
    watchdog = setTimeout(() => fail('trackingInferenceFailed'), 5_000);
    try {
      const bitmap = await createBitmap(video, {
        resizeWidth: Math.max(1, Math.round(source.width * scale)),
        resizeHeight: Math.max(1, Math.round(source.height * scale)),
        resizeQuality: 'low',
      });
      if (stopped || revision !== geometryRevision || source.width !== video.videoWidth || source.height !== video.videoHeight) {
        bitmap.close();
        return;
      }
      // detect takes bitmap ownership even when it rejects. Never close transferred bitmaps here.
      const frame = await tracker.detect({ bitmap, trackingRunId, sequence: submittedSequence, timestampMs, source });
      if (stopped) return;
      synchronizeGeometry();
      if (revision !== geometryRevision) return;
      if (frame.trackingRunId !== trackingRunId || frame.sequence !== submittedSequence || frame.timestampMs !== timestampMs ||
          frame.source.width !== source.width || frame.source.height !== source.height || frame.source.mirrored !== false) {
        fail('trackingInferenceFailed');
        return;
      }
      const completedAt = now();
      firstCompletedAt ??= completedAt;
      const age = completedAt - submittedAt;
      if (age >= 500) { clearOverlay(); return; }
      lastFreshAt = completedAt;
      onFrame(frame);
      if (stopped) return;
      clearTimeout(expiry);
      expiry = setTimeout(clearOverlay, 500 - age);
    } catch (error) {
      if (!stopped) fail(error instanceof TrackingError ? error.code : 'trackingInferenceFailed');
    } finally {
      clearTimeout(watchdog); watchdog = undefined;
      busy = false;
    }
  }

  function schedule() {
    if (stopped) return;
    if (useVideoCallbacks) {
      scheduled = video.requestVideoFrameCallback((_time, metadata) => tick(metadata.mediaTime * 1_000));
    } else {
      scheduled = requestAnimation(() => tick(video.currentTime * 1_000));
    }
  }
  function tick(timestampMs: number) {
    scheduled = null;
    if (stopped) return;
    synchronizeGeometry();
    const current = now();
    const newFrame = Number.isFinite(timestampMs) && timestampMs > lastObservedTimestamp;
    if (newFrame) {
      lastObservedTimestamp = timestampMs;
      // Allow the initial model warmup, but repeated stale results must also fail promptly.
      // Frozen video does not count as slow inference.
      const freshnessBaseline = lastFreshAt ?? firstCompletedAt;
      if (freshnessBaseline !== null && current - freshnessBaseline >= 2_000) {
        fail('trackingTooSlow');
        return;
      }
    }
    if (newFrame && !busy && video.readyState >= 2 && sourceWidth > 0 && sourceHeight > 0 &&
        timestampMs > lastSubmittedTimestamp && current - lastSubmittedAt >= 1_000 / 15) {
      void process(timestampMs, current);
    }
    schedule();
  }

  video.addEventListener('resize', synchronizeGeometry);
  schedule();
  return stop;
}
