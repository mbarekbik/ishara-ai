import { createLandmarkTracker, type TrackingWorker } from "../src/features/sign/tracking/workerClient";
import type { WorkerRequest } from "../src/features/sign/tracking/service";

const button = document.querySelector<HTMLButtonElement>("#start")!;
const result = document.querySelector<HTMLPreElement>("#result")!;
const lines: string[] = [];
const write = (line: string) => { lines.push(line); result.textContent = lines.join("\n"); };
button.addEventListener("click", async () => {
  button.disabled = true; lines.length = 0;
  for (const delegate of ["GPU", "CPU"] as const) {
    const controller = new AbortController();
    const tracker = createLandmarkTracker({ createWorker: () => {
      const worker = new Worker(new URL("../src/features/sign/tracking/landmarkTracking.worker.ts", import.meta.url), { type: "module" });
      const post = worker.postMessage.bind(worker);
      worker.postMessage = (message: WorkerRequest, transfer: Transferable[] = []) => post(message.type === "initialize" ? { ...message, delegate } : message, transfer);
      return worker as TrackingWorker;
    } });
    try {
      write(`${delegate}: initializing`);
      const started = performance.now();
      await tracker.initialize(`verification-${delegate}`, controller.signal);
      write(`${delegate}: ready (${Math.round(performance.now() - started)} ms)`);
      const canvas = new OffscreenCanvas(640, 480);
      canvas.getContext("2d")!.fillRect(0, 0, 640, 480);
      const frame = await tracker.detect({ bitmap: canvas.transferToImageBitmap(), trackingRunId: `verification-${delegate}`, sequence: 1, timestampMs: 1, source: { width: 640, height: 480, mirrored: false } });
      if (frame.pose || frame.face || frame.leftHand || frame.rightHand) throw new Error("Unexpected synthetic-frame detection");
      write(`${delegate}: synthetic inference passed; ${frame.topology}`);
      if (delegate === "GPU") {
        write("Observing telemetry interval for 65 seconds; inspect worker CSP violations.");
        await new Promise((resolve) => setTimeout(resolve, 65_000));
      }
    } catch (error) {
      write(`${delegate}: FAILED (${error instanceof Error && error.message.startsWith("tracking") ? error.message : "runtime failure"})`);
    } finally { await tracker.dispose(); write(`${delegate}: disposed`); }
  }
  write("Verification finished. Synthetic inference does not establish physical-camera tracking quality.");
  button.disabled = false;
});
