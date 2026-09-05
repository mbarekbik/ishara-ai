import { abortableDelay } from "./abortableDelay";
import type {
  CaptureOperation,
  RecognitionResult,
} from "../features/communication/interaction";
export interface MockOptions {
  delayMs?: number;
  fail?: boolean;
  empty?: boolean;
}
export function mockCapture(
  result: RecognitionResult,
  signal: AbortSignal,
  options: MockOptions = {},
): CaptureOperation {
  const controller = new AbortController();
  const cancel = () => {
    controller.abort();
    signal.removeEventListener("abort", cancel);
  };
  if (signal.aborted) cancel();
  else signal.addEventListener("abort", cancel, { once: true });
  let promise: Promise<RecognitionResult> | undefined;
  return {
    cancel,
    finish() {
      promise ??= abortableDelay(options.delayMs ?? 800, controller.signal)
        .then(() => {
          if (options.fail) throw new Error("Simulated failure");
          return options.empty ? { ...result, text: "" } : result;
        })
        .finally(() => signal.removeEventListener("abort", cancel));
      return promise;
    },
  };
}
