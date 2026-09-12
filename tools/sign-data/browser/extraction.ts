import { createLandmarkTracker, type TrackingWorker } from "../../../apps/web/src/features/sign/tracking/workerClient";
import { TRACKING_WORKER_POLICY } from "../../../apps/web/src/features/sign/tracking/runtimeAssets";
import type { LandmarkTracker, WorkerRequest } from "../../../apps/web/src/features/sign/tracking/service";
import { TrackingError } from "../../../apps/web/src/features/sign/tracking/model";

type Delegate = "GPU" | "CPU";
let tracker: LandmarkTracker | null = null;
let runId: string | null = null;
let busy = false;

async function endSample() {
  const previous = tracker;
  tracker = null;
  runId = null;
  await previous?.dispose();
}

const api = {
  policy: TRACKING_WORKER_POLICY,
  async startSample(id: string, requiredDelegate?: Delegate): Promise<Delegate> {
    if (busy || tracker || !id || (requiredDelegate !== undefined && requiredDelegate !== "GPU" && requiredDelegate !== "CPU")) throw new Error("Invalid detector lifecycle");
    let actualDelegate: Delegate | undefined;
    let attempted = 0;
    const controller = new AbortController();
    const next = createLandmarkTracker({
      baseUrl: new URL("/", location.href).href,
      inferenceMs: 30_000,
      createWorker: () => {
        // Production fallback is retained for the first recording. Later recordings
        // use the accepted delegate only; a failure cannot introduce mixed output.
        if (requiredDelegate && attempted > 0) throw new TrackingError("trackingUnsupported");
        attempted += 1;
        const worker = new Worker(new URL("../../../apps/web/src/features/sign/tracking/landmarkTracking.worker.ts", import.meta.url), { type: "module" });
        const nativePost = worker.postMessage.bind(worker);
        worker.postMessage = ((request: WorkerRequest, transfer?: Transferable[]) => {
          if (request.type === "initialize") {
            actualDelegate = requiredDelegate ?? request.delegate;
            nativePost({ ...request, delegate: actualDelegate }, transfer ?? []);
          } else nativePost(request, transfer ?? []);
        }) as typeof worker.postMessage;
        return worker as TrackingWorker;
      },
    });
    tracker = next;
    runId = id;
    try {
      await next.initialize(id, controller.signal);
      if (!actualDelegate || tracker !== next) throw new Error("Detector initialization did not establish a delegate");
      return actualDelegate;
    } catch (error) {
      await endSample();
      throw error;
    }
  },
  async infer(base64: string, width: number, height: number, timestampMs: number, sequence: number, id: string) {
    if (busy || !tracker || id !== runId || !Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1 || width * height > 16_777_216) throw new Error("Invalid offline frame request");
    busy = true;
    try {
      const encoded = atob(base64);
      if (encoded.length !== width * height * 4) throw new Error("Invalid RGBA frame length");
      const rgba = Uint8ClampedArray.from(encoded, value => value.charCodeAt(0));
      const image = new ImageData(rgba, width, height);
      // Identical size/rounding/resize policy to Scope 4; ImageData has no EXIF
      // orientation and no presentation transform is applied to its pixels.
      const scale = Math.min(1, 960 / Math.max(width, height));
      const bitmap = await createImageBitmap(image, {
        resizeWidth: Math.max(1, Math.round(width * scale)),
        resizeHeight: Math.max(1, Math.round(height * scale)),
        resizeQuality: "low",
      });
      const owner = tracker;
      if (!owner || runId !== id) { bitmap.close(); throw new Error("Detector was disposed"); }
      // The production client transfers ownership. Offline processing intentionally
      // has no live-camera freshness scheduler or 500 ms result discard.
      return await owner.detect({ bitmap, trackingRunId: id, sequence, timestampMs, source: { width, height, mirrored: false } });
    } finally { busy = false; }
  },
  endSample,
};

Object.assign(globalThis, { isharaOfflineExtraction: api });
