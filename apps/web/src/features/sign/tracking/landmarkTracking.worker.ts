import { FilesetResolver, HolisticLandmarker } from "@mediapipe/tasks-vision";
import { loadTrackingAssets } from "./runtimeAssets";
import { normalizeHolistic } from "./mediapipeHolisticAdapter";
import { TrackingError } from "./model";
import type { WorkerRequest, WorkerResponse } from "./service";

const scope = self as unknown as {
  onmessage: ((event: MessageEvent<WorkerRequest>) => void) | null;
  postMessage(message: WorkerResponse): void;
};
let detector: HolisticLandmarker | null = null;
let disposed = false;
let runId = "";
let lastTimestamp = -1;
let lastSequence = 0;
function release() { detector?.close(); detector = null; }
scope.onmessage = ({ data }) => {
  if (data.type === "dispose") {
    disposed = true;
    try { release(); } finally { scope.postMessage({ type: "disposed" }); }
    return;
  }
  if (data.type === "initialize") {
    void (async () => {
      try {
        if (runId || disposed) throw new TrackingError("trackingInitializationFailed");
        runId = data.trackingRunId;
        if (typeof OffscreenCanvas === "undefined" || !(await FilesetResolver.isSimdSupported(false))) throw new TrackingError("trackingUnsupported");
        const canvas = new OffscreenCanvas(1, 1);
        if (!canvas.getContext("webgl2")) throw new TrackingError("trackingUnsupported");
        const { model, wasmPath } = await loadTrackingAssets(self.location.href, data.baseUrl);
        if (disposed) return;
        const wasm = await FilesetResolver.forVisionTasks(wasmPath, true);
        const next = await HolisticLandmarker.createFromOptions(wasm, {
          baseOptions: { modelAssetBuffer: model, delegate: data.delegate }, canvas,
          runningMode: "VIDEO", outputFaceBlendshapes: false, outputPoseSegmentationMasks: false,
          minFaceDetectionConfidence: 0.5, minFacePresenceConfidence: 0.5,
          minFaceSuppressionThreshold: 0.3, minPoseDetectionConfidence: 0.5,
          minPosePresenceConfidence: 0.5, minPoseSuppressionThreshold: 0.3, minHandLandmarksConfidence: 0.5,
        });
        if (disposed) { next.close(); return; }
        detector = next;
        scope.postMessage({ type: "ready", trackingRunId: runId });
      } catch (error) {
        if (!disposed) scope.postMessage({ type: "error", code: error instanceof TrackingError ? error.code : "trackingInitializationFailed" });
      }
    })();
    return;
  }
  const { bitmap, ...metadata } = data.input;
  try {
    if (disposed) return;
    if (!detector || metadata.trackingRunId !== runId || !Number.isFinite(metadata.timestampMs) || metadata.timestampMs <= lastTimestamp || metadata.sequence <= lastSequence) throw new TrackingError("trackingInferenceFailed");
    lastTimestamp = metadata.timestampMs;
    lastSequence = metadata.sequence;
    detector.detectForVideo(bitmap, metadata.timestampMs, (result) => {
      const frame = normalizeHolistic(result, metadata);
      scope.postMessage({ type: "result", frame });
    });
  } catch {
    scope.postMessage({ type: "error", code: "trackingInferenceFailed" });
  } finally { bitmap.close(); }
};
