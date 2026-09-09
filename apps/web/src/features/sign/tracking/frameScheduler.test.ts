import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { startFrameScheduler } from './frameScheduler';
import { TrackingError, type LandmarkFrame } from './model';
import type { LandmarkTracker, TrackingInput } from './service';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function bitmap() { return { close: vi.fn() } as unknown as ImageBitmap; }
function result(input: TrackingInput): LandmarkFrame {
  return {
    schemaVersion: 1, topology: 'human-553-v1', trackingRunId: input.trackingRunId,
    sequence: input.sequence, timestampMs: input.timestampMs, source: input.source,
    pose: null, face: null, leftHand: null, rightHand: null,
  };
}
async function flush() { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); }

function setup(useVideoCallbacks = true, width = 1280, height = 720) {
  const video = document.createElement('video');
  Object.defineProperties(video, {
    videoWidth: { value: width, writable: true }, videoHeight: { value: height, writable: true },
    readyState: { value: 2, writable: true },
  });
  let identifier = 0;
  const callbacks = new Map<number, VideoFrameRequestCallback>();
  const animationCallbacks = new Map<number, FrameRequestCallback>();
  const requestVideo = vi.fn((callback: VideoFrameRequestCallback) => { const id = ++identifier; callbacks.set(id, callback); return id; });
  const cancelVideo = vi.fn((id: number) => { callbacks.delete(id); });
  if (useVideoCallbacks) {
    video.requestVideoFrameCallback = requestVideo;
    video.cancelVideoFrameCallback = cancelVideo;
  }
  const requestAnimation = vi.fn((callback: FrameRequestCallback) => { const id = ++identifier; animationCallbacks.set(id, callback); return id; });
  const cancelAnimation = vi.fn((id: number) => { animationCallbacks.delete(id); });
  const createBitmap = vi.fn(async () => bitmap());
  const tracker: LandmarkTracker = {
    initialize: vi.fn(async () => {}), detect: vi.fn(async (input: TrackingInput) => result(input)),
    dispose: vi.fn(async () => {}),
  };
  const onFrame = vi.fn(), onError = vi.fn(), onClear = vi.fn();
  const stop = startFrameScheduler({ video, tracker, trackingRunId: 'run-a', onFrame, onError, onClear }, {
    createBitmap, requestAnimationFrame: requestAnimation, cancelAnimationFrame: cancelAnimation,
  });
  function emit(mediaTime: number) {
    if (useVideoCallbacks) {
      const next = callbacks.entries().next().value;
      if (!next) return;
      callbacks.delete(next[0]);
      next[1](performance.now(), { mediaTime } as VideoFrameCallbackMetadata);
    } else {
      video.currentTime = mediaTime;
      const next = animationCallbacks.entries().next().value;
      if (!next) return;
      animationCallbacks.delete(next[0]);
      next[1](performance.now());
    }
  }
  return { video, tracker, createBitmap, onFrame, onError, onClear, stop, emit, callbacks, animationCallbacks, cancelVideo, cancelAnimation };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); });

describe('decoded-frame scheduler', () => {
  test('preserves source geometry and video time while resizing to a 960-pixel long edge', async () => {
    const context = setup();
    context.emit(1.25);
    await flush();
    expect(context.createBitmap).toHaveBeenCalledWith(context.video, { resizeWidth: 960, resizeHeight: 540, resizeQuality: 'low' });
    expect(context.tracker.detect).toHaveBeenCalledWith(expect.objectContaining({
      trackingRunId: 'run-a', sequence: 1, timestampMs: 1250,
      source: { width: 1280, height: 720, mirrored: false },
    }));
    expect(context.onFrame).toHaveBeenCalledWith(expect.objectContaining({ pose: null, face: null, leftHand: null, rightHand: null }));
    expect(context.tracker.initialize).not.toHaveBeenCalled();
    context.stop();
    expect(context.tracker.dispose).not.toHaveBeenCalled();
  });

  test.each([[720, 1280, 540, 960], [320, 240, 320, 240]])('preserves aspect ratio without upscaling %s × %s', async (width, height, resizedWidth, resizedHeight) => {
    const context = setup(true, width, height);
    context.emit(0);
    await flush();
    expect(context.createBitmap).toHaveBeenCalledWith(context.video, expect.objectContaining({ resizeWidth: resizedWidth, resizeHeight: resizedHeight }));
    context.stop();
  });

  test('sets its busy guard before bitmap creation and never queues skipped frames', async () => {
    const context = setup();
    const pendingBitmap = deferred<ImageBitmap>();
    context.createBitmap.mockReturnValueOnce(pendingBitmap.promise);
    context.emit(0);
    await vi.advanceTimersByTimeAsync(100);
    context.emit(0.1);
    await vi.advanceTimersByTimeAsync(100);
    context.emit(0.2);
    expect(context.createBitmap).toHaveBeenCalledOnce();
    expect(context.tracker.detect).not.toHaveBeenCalled();
    const created = bitmap();
    pendingBitmap.resolve(created);
    await flush();
    expect(context.tracker.detect).toHaveBeenCalledOnce();
    expect(created.close).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(100);
    context.emit(0.3);
    await flush();
    expect(context.tracker.detect).toHaveBeenCalledTimes(2);
    const second = vi.mocked(context.tracker.detect).mock.calls[1][0];
    expect(second.timestampMs).toBe(300);
    expect(second.sequence).toBe(2);
    context.stop();
  });

  test('keeps inference nonoverlapping and submits at most fifteen times per second', async () => {
    const context = setup();
    const pending = deferred<LandmarkFrame>();
    vi.mocked(context.tracker.detect).mockReturnValueOnce(pending.promise);
    context.emit(0);
    await flush();
    await vi.advanceTimersByTimeAsync(100);
    context.emit(0.1);
    expect(context.createBitmap).toHaveBeenCalledOnce();
    pending.resolve(result(vi.mocked(context.tracker.detect).mock.calls[0][0]));
    await flush();
    context.emit(0.101);
    await flush();
    await vi.advanceTimersByTimeAsync(66);
    context.emit(0.167);
    await flush();
    expect(context.createBitmap).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1);
    context.emit(0.168);
    await flush();
    expect(context.createBitmap).toHaveBeenCalledTimes(3);
    context.stop();
  });

  test('rAF fallback skips unchanged or regressed currentTime and has strictly increasing timestamps', async () => {
    const context = setup(false);
    context.emit(1);
    await flush();
    await vi.advanceTimersByTimeAsync(100);
    context.emit(1);
    context.emit(0.5);
    await flush();
    expect(context.createBitmap).toHaveBeenCalledOnce();
    context.emit(1.1);
    await flush();
    expect(vi.mocked(context.tracker.detect).mock.calls.map(([input]) => input.timestampMs)).toEqual([1000, 1100]);
    context.stop();
    expect(context.cancelAnimation).toHaveBeenCalledOnce();
    expect(context.animationCallbacks.size).toBe(0);
  });

  test('does not create bitmaps before decoded dimensions are available', async () => {
    const context = setup(true, 0, 0);
    context.emit(0);
    await flush();
    expect(context.createBitmap).not.toHaveBeenCalled();
    context.stop();
  });

  test('clears old geometry and discards in-flight results when the camera dimensions change', async () => {
    const context = setup();
    const pending = deferred<LandmarkFrame>();
    vi.mocked(context.tracker.detect).mockReturnValueOnce(pending.promise);
    context.emit(0);
    await flush();
    Object.defineProperty(context.video, 'videoWidth', { value: 640 });
    context.video.dispatchEvent(new Event('resize'));
    expect(context.onClear).toHaveBeenCalledOnce();
    pending.resolve(result(vi.mocked(context.tracker.detect).mock.calls[0][0]));
    await flush();
    expect(context.onFrame).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(100);
    context.emit(0.1);
    await flush();
    expect(context.onFrame).toHaveBeenCalledWith(expect.objectContaining({ source: { width: 640, height: 720, mirrored: false } }));
    context.stop();
  });

  test('closes a bitmap created after cancellation without submitting it', async () => {
    const context = setup();
    const pending = deferred<ImageBitmap>();
    context.createBitmap.mockReturnValueOnce(pending.promise);
    context.emit(0);
    context.stop(); context.stop();
    const created = bitmap();
    pending.resolve(created);
    await flush();
    expect(created.close).toHaveBeenCalledOnce();
    expect(context.tracker.detect).not.toHaveBeenCalled();
    expect(context.onFrame).not.toHaveBeenCalled();
    expect(context.cancelVideo).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  test('discards late results after cancellation and leaves transferred bitmap disposal to the tracker', async () => {
    const context = setup();
    const pending = deferred<LandmarkFrame>();
    vi.mocked(context.tracker.detect).mockReturnValueOnce(pending.promise);
    context.emit(0);
    await flush();
    const submitted = vi.mocked(context.tracker.detect).mock.calls[0][0];
    context.stop();
    pending.resolve(result(submitted));
    await flush();
    expect(context.onFrame).not.toHaveBeenCalled();
    expect(submitted.bitmap.close).not.toHaveBeenCalled();
    expect(context.onError).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  test('discards results older than 500 ms and expires accepted overlay age from submission time', async () => {
    const context = setup();
    const pending = deferred<LandmarkFrame>();
    vi.mocked(context.tracker.detect).mockReturnValueOnce(pending.promise);
    context.emit(0);
    await flush();
    await vi.advanceTimersByTimeAsync(500);
    pending.resolve(result(vi.mocked(context.tracker.detect).mock.calls[0][0]));
    await flush();
    expect(context.onFrame).not.toHaveBeenCalled();
    context.emit(0.5);
    await flush();
    expect(context.onFrame).toHaveBeenCalledOnce();
    context.onClear.mockClear();
    await vi.advanceTimersByTimeAsync(499);
    expect(context.onClear).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(context.onClear).toHaveBeenCalledOnce();
    context.stop();
  });

  test('allows startup warmup but reports sustained missing fresh frames after first accepted output', async () => {
    const context = setup();
    const initial = deferred<LandmarkFrame>();
    vi.mocked(context.tracker.detect).mockReturnValueOnce(initial.promise);
    context.emit(0);
    await flush();
    await vi.advanceTimersByTimeAsync(2500);
    context.emit(2.5);
    expect(context.onError).not.toHaveBeenCalled();
    initial.resolve(result(vi.mocked(context.tracker.detect).mock.calls[0][0]));
    await flush();
    context.emit(2.501);
    await flush();
    expect(context.onFrame).toHaveBeenCalledOnce();
    vi.mocked(context.tracker.detect).mockReturnValueOnce(new Promise(() => {}));
    await vi.advanceTimersByTimeAsync(100);
    context.emit(2.601);
    await flush();
    await vi.advanceTimersByTimeAsync(1900);
    context.emit(4.501);
    expect(context.onError).toHaveBeenCalledWith('trackingTooSlow');
    expect(context.callbacks.size).toBe(0);
    expect(context.tracker.dispose).not.toHaveBeenCalled();
  });

  test('unchanged video time does not trigger the slow-tracking failure', async () => {
    const context = setup(false);
    context.emit(0);
    await flush();
    await vi.advanceTimersByTimeAsync(2500);
    context.emit(0);
    expect(context.onError).not.toHaveBeenCalled();
    context.stop();
  });

  test('successful but continuously stale results cannot remain in startup forever', async () => {
    const context = setup();
    for (let index = 0; index < 4; index += 1) {
      const pending = deferred<LandmarkFrame>();
      vi.mocked(context.tracker.detect).mockReturnValueOnce(pending.promise);
      context.emit(index * 0.6);
      await flush();
      await vi.advanceTimersByTimeAsync(600);
      pending.resolve(result(vi.mocked(context.tracker.detect).mock.calls[index][0]));
      await flush();
    }
    expect(context.onFrame).not.toHaveBeenCalled();
    expect(context.onError).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(200);
    context.emit(2.6);
    expect(context.onError).toHaveBeenCalledWith('trackingTooSlow');
    expect(context.callbacks.size).toBe(0);
  });

  test.each(['bitmap', 'inference'] as const)('bounds hung %s work to five seconds', async (kind) => {
    const context = setup();
    const pendingBitmap = deferred<ImageBitmap>();
    if (kind === 'bitmap') context.createBitmap.mockReturnValueOnce(pendingBitmap.promise);
    else vi.mocked(context.tracker.detect).mockReturnValueOnce(new Promise(() => {}));
    context.emit(0);
    await flush();
    await vi.advanceTimersByTimeAsync(4_999);
    expect(context.onError).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(context.onError).toHaveBeenCalledOnce();
    expect(context.onError).toHaveBeenCalledWith('trackingInferenceFailed');
    expect(context.callbacks.size).toBe(0);
    const created = bitmap();
    pendingBitmap.resolve(created);
    await flush();
    if (kind === 'bitmap') expect(created.close).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  test('normalizes technical errors without forwarding raw provider data', async () => {
    const context = setup();
    vi.mocked(context.tracker.detect).mockRejectedValueOnce(new Error('Synthetic provider internals'));
    context.emit(0);
    await flush();
    expect(context.onError).toHaveBeenCalledWith('trackingInferenceFailed');
    expect(context.onFrame).not.toHaveBeenCalled();
    expect(context.callbacks.size).toBe(0);
    const known = setup();
    vi.mocked(known.tracker.detect).mockRejectedValueOnce(new TrackingError('trackingTooSlow'));
    known.emit(0);
    await flush();
    expect(known.onError).toHaveBeenCalledWith('trackingTooSlow');
  });

  test('rejects uncorrelated output and cancels all its resources when a consumer stops onFrame', async () => {
    const invalid = setup();
    vi.mocked(invalid.tracker.detect).mockImplementationOnce(async input => ({ ...result(input), trackingRunId: 'old-run' }));
    invalid.emit(0);
    await flush();
    expect(invalid.onFrame).not.toHaveBeenCalled();
    expect(invalid.onError).toHaveBeenCalledWith('trackingInferenceFailed');
    const valid = setup();
    valid.onFrame.mockImplementationOnce(() => valid.stop());
    valid.emit(0);
    await flush();
    expect(valid.callbacks.size).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });
});
