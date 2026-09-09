import { TrackingError, type LandmarkFrame } from "./model";
import type { LandmarkTracker, TrackingInput, WorkerRequest, WorkerResponse } from "./service";

export interface TrackingWorker {
  onmessage: ((event: MessageEvent<WorkerResponse>) => void) | null;
  onerror: ((event: ErrorEvent) => void) | null;
  onmessageerror: ((event: MessageEvent) => void) | null;
  postMessage(message: WorkerRequest, transfer?: Transferable[]): void;
  terminate(): void;
}
interface Options { createWorker?: () => TrackingWorker; baseUrl?: string; initializationMs?: number; inferenceMs?: number; closeMs?: number }
export function createLandmarkTracker(options: Options = {}): LandmarkTracker {
  const makeWorker = options.createWorker ?? (() => {
    if (typeof Worker !== "function" || typeof createImageBitmap !== "function") throw new TrackingError("trackingUnsupported");
    return new Worker(new URL("./landmarkTracking.worker.ts", import.meta.url), { type: "module" });
  });
  let worker: TrackingWorker | null = null;
  let closed = false;
  let ready = false;
  let started = false;
  let runId = "";
  let pending: { resolve: (message: WorkerResponse) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> } | null = null;
  let disposal: Promise<void> | null = null;
  let removeAbort = () => {};
  function rejectPending(error: Error) {
    if (!pending) return;
    clearTimeout(pending.timer);
    const current = pending; pending = null; current.reject(error);
  }
  function terminate() {
    if (worker) { worker.onmessage = null; worker.onerror = null; worker.onmessageerror = null; worker.terminate(); worker = null; }
    ready = false;
  }
  function exchange(message: WorkerRequest, timeout: number, transfer?: Transferable[]): Promise<WorkerResponse> {
    if (!worker || pending) return Promise.reject(new TrackingError("trackingInferenceFailed"));
    return new Promise((resolve, reject) => {
      pending = { resolve, reject, timer: setTimeout(() => {
        rejectPending(new TrackingError(message.type === "initialize" ? "trackingInitializationFailed" : "trackingInferenceFailed"));
        terminate();
      }, timeout) };
      try { worker!.postMessage(message, transfer); } catch { rejectPending(new TrackingError("trackingInferenceFailed")); }
    });
  }
  function attach(next: TrackingWorker) {
    worker = next;
    next.onmessage = ({ data }) => {
      if (worker !== next || !pending) return;
      if (data.type === "error") { rejectPending(new TrackingError(data.code)); return; }
      const current = pending; pending = null; clearTimeout(current.timer); current.resolve(data);
    };
    next.onerror = () => { if (worker === next) { rejectPending(new TrackingError(ready ? "trackingInferenceFailed" : "trackingInitializationFailed")); terminate(); } };
    next.onmessageerror = () => { if (worker === next) { rejectPending(new TrackingError("trackingInferenceFailed")); terminate(); } };
  }
  const api: LandmarkTracker = {
    async initialize(id, signal) {
      if (started || closed || signal.aborted) throw new DOMException("Cancelled", "AbortError");
      started = true; runId = id;
      const abort = () => { void api.dispose(); };
      signal.addEventListener("abort", abort, { once: true });
      removeAbort = () => signal.removeEventListener("abort", abort);
      for (const delegate of ["GPU", "CPU"] as const) {
        try {
          if (closed || signal.aborted) throw new DOMException("Cancelled", "AbortError");
          attach(makeWorker());
          const response = await exchange({ type: "initialize", delegate, trackingRunId: id, baseUrl: options.baseUrl ?? new URL(import.meta.env.BASE_URL, window.location.href).href }, options.initializationMs ?? 30_000);
          if (closed || signal.aborted) throw new DOMException("Cancelled", "AbortError");
          if (response.type !== "ready" || response.trackingRunId !== id) throw new TrackingError("trackingInitializationFailed");
          ready = true; return;
        } catch (error) {
          terminate();
          if (closed || signal.aborted) throw new DOMException("Cancelled", "AbortError");
          if (delegate === "CPU" || (error instanceof TrackingError && error.code !== "trackingInitializationFailed")) { removeAbort(); throw error; }
        }
      }
    },
    async detect(input: TrackingInput): Promise<LandmarkFrame> {
      if (closed || !ready || pending || input.trackingRunId !== runId) { input.bitmap.close(); throw new TrackingError("trackingInferenceFailed"); }
      try {
        const response = await exchange({ type: "frame", input }, options.inferenceMs ?? 5_000, [input.bitmap]);
        if (closed) throw new DOMException("Cancelled", "AbortError");
        if (response.type !== "result" || response.frame.trackingRunId !== runId || response.frame.sequence !== input.sequence || response.frame.timestampMs !== input.timestampMs || response.frame.source.width !== input.source.width || response.frame.source.height !== input.source.height || response.frame.source.mirrored !== false) throw new TrackingError("trackingInferenceFailed");
        return response.frame;
      } catch (error) {
        // close() is also safe on a bitmap detached by successful transfer.
        input.bitmap.close(); terminate(); throw error;
      }
    },
    dispose() {
      if (disposal) return disposal;
      closed = true; ready = false; removeAbort();
      rejectPending(new DOMException("Cancelled", "AbortError"));
      disposal = (async () => {
        try { if (worker) await exchange({ type: "dispose" }, options.closeMs ?? 250); } catch { /* Termination is the bounded disposal fallback. */ }
        finally { terminate(); }
      })();
      return disposal;
    },
  };
  return api;
}
