import { createMicrophoneCapture, type MicrophoneCapture } from "./microphoneCapture";
import { openGeminiLiveClient } from "./geminiLiveClient";
import { getLiveToken } from "./tokenClient";
import { createTranscriptAccumulator } from "./transcriptAccumulator";
import type { SpeechService } from "./service";
import type { RecognitionResult } from "../communication/interaction";
import { voiceError } from "./errors";
// Bounded receive-drain policy, not a provider-guaranteed completion barrier.
// Only provider-final text is eligible; unresolved interim text fails.
export const FINAL_SETTLE_MS = 2000;
export const FINAL_DEADLINE_MS = 10_000;
export function createGeminiLiveSpeechService(dependencies = {
  capture: createMicrophoneCapture, token: getLiveToken, connect: openGeminiLiveClient,
}): SpeechService {
  return {
    kind: "service",
    async begin(input) {
      const lifetime = new AbortController();
      const abort = () => cancel();
      let mic: MicrophoneCapture | undefined;
      let connection: ReturnType<typeof openGeminiLiveClient> | undefined;
      let disposed = false, ending = false, endSent = false;
      let settleTimer: ReturnType<typeof setTimeout> | undefined;
      let deadlineTimer: ReturnType<typeof setTimeout> | undefined;
      let finishPromise: Promise<RecognitionResult> | undefined;
      let resolveFinish: ((value: RecognitionResult) => void) | undefined;
      let rejectFinish: ((error: Error) => void) | undefined;
      const transcript = createTranscriptAccumulator();
      function cancel() {
        if (disposed) return;
        disposed = true;
        input.signal.removeEventListener("abort", abort);
        clearTimeout(settleTimer); clearTimeout(deadlineTimer);
        lifetime.abort(); mic?.cancel(); connection?.close();
        rejectFinish?.(new DOMException("Cancelled", "AbortError"));
      }
      function fail(code: string) {
        if (disposed) return;
        rejectFinish?.(new Error(voiceError(code)));
        cancel(); input.onError(voiceError(code));
      }
      function scheduleSettlement() {
        clearTimeout(settleTimer);
        const draft = transcript.snapshot();
        if (!endSent || disposed || !draft.finalText || draft.interimText.trim()) return;
        settleTimer = setTimeout(() => {
          if (disposed) return;
          const current = transcript.snapshot();
          if (current.interimText.trim()) return;
          resolveFinish?.({ text: current.finalText, language: current.language, source: "service" });
          cancel();
        }, FINAL_SETTLE_MS);
      }
      input.signal.addEventListener("abort", abort, { once: true });
      if (input.signal.aborted) { cancel(); throw new DOMException("Cancelled", "AbortError"); }
      try {
        input.onPhase("requesting-permission");
        mic = await dependencies.capture({ signal: lifetime.signal, onError: fail, onAudio: (pcm, rate) => {
          if (!disposed) connection?.sendAudio(pcm, rate);
        } });
        if (disposed) { mic.cancel(); throw new DOMException("Cancelled", "AbortError"); }
        input.onPhase("connecting");
        const credential = await dependencies.token(input.speechLanguage, lifetime.signal);
        if (disposed) throw new DOMException("Cancelled", "AbortError");
        connection = dependencies.connect({ credential, signal: lifetime.signal, onError: fail,
          onObservation: (event) => {
            if (disposed || event.kind === "model-turn-complete") return;
            transcript.accept(event); input.onDraft(transcript.snapshot());
            if (ending) scheduleSettlement();
          },
        });
        await connection.ready;
        if (disposed) throw new DOMException("Cancelled", "AbortError");
        connection.start(); mic.start(); input.onPhase("listening");
        return {
          cancel,
          finish() {
            if (finishPromise) return finishPromise;
            if (disposed) return Promise.reject(new DOMException("Cancelled", "AbortError"));
            ending = true;
            finishPromise = new Promise((resolve, reject) => { resolveFinish = resolve; rejectFinish = reject; });
            void finishPromise.catch(() => undefined);
            input.onPhase("finalizing");
            void mic!.stop().then(() => {
              if (disposed) return;
              connection!.end(); endSent = true;
              deadlineTimer = setTimeout(() => {
                const draft = transcript.snapshot();
                fail(draft.interimText.trim() ? "LIVE_INCOMPLETE_TRANSCRIPT" : draft.finalText ? "LIVE_FINALIZATION_TIMEOUT" : "emptyResult");
              }, FINAL_DEADLINE_MS);
              scheduleSettlement();
            }).catch((error: unknown) => { if (!disposed) fail(voiceError(error, "MIC_CAPTURE_ERROR")); });
            return finishPromise;
          },
        };
      } catch (error) { cancel(); throw error; }
    },
  };
}
