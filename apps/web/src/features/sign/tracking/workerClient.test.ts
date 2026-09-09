import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import type { LandmarkFrame } from './model';
import type { FrameMetadata, TrackingInput, WorkerRequest, WorkerResponse } from './service';
import { createLandmarkTracker, type TrackingWorker } from './workerClient';

class FakeWorker implements TrackingWorker {
  onmessage: TrackingWorker['onmessage'] = null;
  onerror: TrackingWorker['onerror'] = null;
  onmessageerror: TrackingWorker['onmessageerror'] = null;
  postMessage = vi.fn<(message: WorkerRequest, transfer?: Transferable[]) => void>();
  terminate = vi.fn();
  emit(message: WorkerResponse) { this.onmessage?.(new MessageEvent('message', { data: message })); }
}

const metadata: FrameMetadata = {
  trackingRunId: 'run-a', sequence: 1, timestampMs: 80,
  source: { width: 1280, height: 720, mirrored: false },
};
function input(overrides: Partial<FrameMetadata> = {}): TrackingInput {
  return { ...metadata, ...overrides, bitmap: { close: vi.fn() } as unknown as ImageBitmap };
}
function frame(overrides: Partial<LandmarkFrame> = {}): LandmarkFrame {
  return {
    ...metadata, schemaVersion: 1, topology: 'human-553-v1',
    pose: null, leftHand: null, rightHand: null, face: null, ...overrides,
  };
}
function setup() {
  const workers: FakeWorker[] = [];
  const createWorker = vi.fn(() => { const worker = new FakeWorker(); workers.push(worker); return worker; });
  const tracker = createLandmarkTracker({ createWorker, baseUrl: 'http://127.0.0.1:5173/' });
  const controller = new AbortController();
  const initialization = tracker.initialize('run-a', controller.signal);
  return { tracker, workers, createWorker, controller, initialization };
}
async function ready() {
  const context = setup();
  context.workers[0].emit({ type: 'ready', trackingRunId: 'run-a' });
  await context.initialization;
  return context;
}
async function close(tracker: ReturnType<typeof createLandmarkTracker>, worker: FakeWorker) {
  const closing = tracker.dispose();
  worker.emit({ type: 'disposed' });
  await closing;
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); });

describe('dedicated tracking worker ownership', () => {
  test('uses a single GPU worker and transfers the bitmap only after setup acknowledgement', async () => {
    const context = setup();
    const worker = context.workers[0];
    expect(worker.postMessage).toHaveBeenCalledWith({
      type: 'initialize', delegate: 'GPU', trackingRunId: 'run-a', baseUrl: 'http://127.0.0.1:5173/',
    }, undefined);
    const premature = input();
    await expect(context.tracker.detect(premature)).rejects.toThrow('trackingInferenceFailed');
    expect(premature.bitmap.close).toHaveBeenCalledOnce();
    worker.emit({ type: 'ready', trackingRunId: 'run-a' });
    await context.initialization;
    const submitted = input();
    const detection = context.tracker.detect(submitted);
    expect(worker.postMessage).toHaveBeenLastCalledWith({ type: 'frame', input: submitted }, [submitted.bitmap]);
    worker.emit({ type: 'result', frame: frame() });
    await expect(detection).resolves.toEqual(frame());
    expect(submitted.bitmap.close).not.toHaveBeenCalled(); // Ownership transferred to the worker.
    expect(context.createWorker).toHaveBeenCalledOnce();
    await close(context.tracker, worker);
  });

  test('terminates failed GPU initialization before one fresh CPU attempt', async () => {
    const context = setup();
    const gpu = context.workers[0];
    const staleCallback = gpu.onmessage;
    gpu.emit({ type: 'error', code: 'trackingInitializationFailed' });
    await Promise.resolve();
    expect(gpu.terminate).toHaveBeenCalledOnce();
    expect(context.createWorker).toHaveBeenCalledTimes(2);
    const cpu = context.workers[1];
    expect(cpu.postMessage.mock.calls[0][0]).toMatchObject({ type: 'initialize', delegate: 'CPU' });
    staleCallback?.(new MessageEvent('message', { data: { type: 'ready', trackingRunId: 'run-a' } }));
    cpu.emit({ type: 'ready', trackingRunId: 'run-a' });
    await expect(context.initialization).resolves.toBeUndefined();
    await close(context.tracker, cpu);
  });

  test.each(['trackingUnsupported', 'trackingAssetsUnavailable'] as const)('does not retry %s with CPU', async (code) => {
    const context = setup();
    const rejection = expect(context.initialization).rejects.toMatchObject({ code });
    context.workers[0].emit({ type: 'error', code });
    await rejection;
    expect(context.createWorker).toHaveBeenCalledOnce();
    expect(context.workers[0].terminate).toHaveBeenCalledOnce();
    await context.tracker.dispose();
  });

  test('both initialization attempts have a 30-second deadline and cannot create a third worker', async () => {
    const context = setup();
    const rejection = expect(context.initialization).rejects.toThrow('trackingInitializationFailed');
    await vi.advanceTimersByTimeAsync(29_999);
    expect(context.createWorker).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(1);
    expect(context.createWorker).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(30_000);
    await rejection;
    expect(context.workers.every(worker => worker.terminate.mock.calls.length === 1)).toBe(true);
    expect(context.createWorker).toHaveBeenCalledTimes(2);
    await context.tracker.dispose();
  });

  test('cancel during initialization rejects and ignores a late ready without CPU retry', async () => {
    const context = setup();
    const worker = context.workers[0];
    const lateCallback = worker.onmessage;
    const rejection = expect(context.initialization).rejects.toMatchObject({ name: 'AbortError' });
    context.controller.abort();
    await rejection;
    lateCallback?.(new MessageEvent('message', { data: { type: 'ready', trackingRunId: 'run-a' } }));
    await vi.advanceTimersByTimeAsync(250);
    await context.tracker.dispose();
    expect(context.createWorker).toHaveBeenCalledOnce();
    expect(worker.terminate).toHaveBeenCalledOnce();
    const submitted = input();
    await expect(context.tracker.detect(submitted)).rejects.toThrow();
    expect(submitted.bitmap.close).toHaveBeenCalledOnce();
  });

  test('pre-aborted initialization never allocates a worker', async () => {
    const createWorker = vi.fn(() => new FakeWorker());
    const tracker = createLandmarkTracker({ createWorker });
    const controller = new AbortController();
    controller.abort();
    await expect(tracker.initialize('run-a', controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
    expect(createWorker).not.toHaveBeenCalled();
  });

  test('duplicate initialization and busy frame submission allocate no extra resources', async () => {
    const context = await ready();
    await expect(context.tracker.initialize('run-b', context.controller.signal)).rejects.toThrow();
    const first = input();
    const pending = context.tracker.detect(first);
    const duplicate = input({ sequence: 2, timestampMs: 160 });
    await expect(context.tracker.detect(duplicate)).rejects.toThrow('trackingInferenceFailed');
    expect(duplicate.bitmap.close).toHaveBeenCalledOnce();
    expect(context.workers[0].postMessage).toHaveBeenCalledTimes(2);
    context.workers[0].emit({ type: 'result', frame: frame() });
    await expect(pending).resolves.toEqual(frame());
    expect(context.createWorker).toHaveBeenCalledOnce();
    await close(context.tracker, context.workers[0]);
  });

  test('rejects a request from another run without transferring its bitmap', async () => {
    const context = await ready();
    const submitted = input({ trackingRunId: 'other-run' });
    await expect(context.tracker.detect(submitted)).rejects.toThrow('trackingInferenceFailed');
    expect(submitted.bitmap.close).toHaveBeenCalledOnce();
    expect(context.workers[0].postMessage).toHaveBeenCalledTimes(1);
    await close(context.tracker, context.workers[0]);
  });

  test.each([
    { trackingRunId: 'old-run' }, { sequence: 99 }, { timestampMs: 81 },
    { source: { width: 640, height: 480, mirrored: false as const } },
  ])('rejects a result that does not match all requested frame metadata (%j)', async (mismatch) => {
    const context = await ready();
    const submitted = input();
    const pending = context.tracker.detect(submitted);
    context.workers[0].emit({ type: 'result', frame: frame(mismatch) });
    await expect(pending).rejects.toThrow('trackingInferenceFailed');
    expect(context.workers[0].terminate).toHaveBeenCalledOnce();
    expect(submitted.bitmap.close).toHaveBeenCalledOnce();
    await context.tracker.dispose();
  });

  test('a hung inference fails at five seconds and terminates the worker', async () => {
    const context = await ready();
    const pending = context.tracker.detect(input());
    const rejection = expect(pending).rejects.toThrow('trackingInferenceFailed');
    await vi.advanceTimersByTimeAsync(4_999);
    expect(context.workers[0].terminate).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    await rejection;
    expect(context.workers[0].terminate).toHaveBeenCalledOnce();
    await context.tracker.dispose();
  });

  test.each(['error', 'messageerror'] as const)('worker %s interrupts inference and releases ownership', async (kind) => {
    const context = await ready();
    const submitted = input();
    const pending = context.tracker.detect(submitted);
    if (kind === 'error') context.workers[0].onerror?.(new ErrorEvent('error'));
    else context.workers[0].onmessageerror?.(new MessageEvent('messageerror'));
    await expect(pending).rejects.toThrow('trackingInferenceFailed');
    expect(submitted.bitmap.close).toHaveBeenCalledOnce();
    expect(context.workers[0].terminate).toHaveBeenCalledOnce();
    await context.tracker.dispose();
  });

  test('transfer failure closes the untransferred bitmap and terminates the worker', async () => {
    const context = await ready();
    context.workers[0].postMessage.mockImplementationOnce(() => { throw new DOMException('Synthetic transfer failure', 'DataCloneError'); });
    const submitted = input();
    await expect(context.tracker.detect(submitted)).rejects.toThrow('trackingInferenceFailed');
    expect(submitted.bitmap.close).toHaveBeenCalledOnce();
    expect(context.workers[0].terminate).toHaveBeenCalledOnce();
    await context.tracker.dispose();
  });

  test('disposal is idempotent and terminates after acknowledgement', async () => {
    const context = await ready();
    const closing = context.tracker.dispose();
    expect(context.tracker.dispose()).toBe(closing);
    expect(context.workers[0].postMessage).toHaveBeenLastCalledWith({ type: 'dispose' }, undefined);
    context.workers[0].emit({ type: 'disposed' });
    await closing;
    expect(context.workers[0].terminate).toHaveBeenCalledOnce();
    expect(context.workers[0].onmessage).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
  });

  test('unanswered disposal is bounded to 250 ms', async () => {
    const context = await ready();
    const closing = context.tracker.dispose();
    await vi.advanceTimersByTimeAsync(249);
    expect(context.workers[0].terminate).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    await closing;
    expect(context.workers[0].terminate).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  test('cancel during inference never resolves a late transcript-free landmark result', async () => {
    const context = await ready();
    const worker = context.workers[0];
    const lateCallback = worker.onmessage;
    const pending = context.tracker.detect(input());
    const rejection = expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    context.controller.abort();
    lateCallback?.(new MessageEvent('message', { data: { type: 'result', frame: frame() } }));
    await rejection;
    await context.tracker.dispose();
    expect(worker.terminate).toHaveBeenCalledOnce();
    expect(context.createWorker).toHaveBeenCalledOnce();
  });
});
