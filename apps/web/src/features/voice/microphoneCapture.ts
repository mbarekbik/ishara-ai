import workletUrl from "./pcmCapture.worklet.ts?worker&url";

export interface MicrophoneCapture {
  start(): void;
  stop(): Promise<void>;
  cancel(): void;
}

function microphoneError(error: unknown): string {
  const name = error instanceof Error || error instanceof DOMException ? error.name : "";
  if (name === "NotAllowedError") return "MIC_DENIED";
  if (name === "NotFoundError") return "MIC_MISSING";
  if (name === "NotReadableError" || name === "AbortError") return "MIC_BUSY";
  if (name === "SecurityError" || name === "NotSupportedError") return "MIC_UNSUPPORTED";
  return "MIC_CAPTURE_ERROR";
}

/** Call directly from the Start gesture; context resume happens before any await. */
export async function createMicrophoneCapture(input: {
  signal: AbortSignal;
  onAudio: (pcm: ArrayBuffer, sampleRate: number) => void;
  onError: (code: string) => void;
}): Promise<MicrophoneCapture> {
  const { signal } = input;
  const aborted = () => new DOMException("Cancelled", "AbortError");
  if (signal.aborted) throw aborted();
  if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia ||
      typeof AudioContext === "undefined" || typeof AudioWorkletNode === "undefined") {
    throw new Error("MIC_UNSUPPORTED");
  }

  let context: AudioContext;
  try {
    try { context = new AudioContext({ sampleRate: 16000 }); }
    catch (error) {
      if (!(error instanceof DOMException) || error.name !== "NotSupportedError") throw error;
      context = new AudioContext();
    }
  } catch (error) { throw new Error(microphoneError(error)); }

  let disposed = false;
  let started = false;
  let stopping = false;
  let stream: MediaStream | undefined;
  let source: MediaStreamAudioSourceNode | undefined;
  let processor: AudioWorkletNode | undefined;
  let resumeComplete = false;
  let closePromise: Promise<void> | undefined;
  let stopPromise: Promise<void> | undefined;
  let flushTimer: ReturnType<typeof setTimeout> | undefined;
  let resolveFlush: (() => void) | undefined;
  let rejectFlush: ((error: Error) => void) | undefined;
  let rejectLifetime!: (error: Error) => void;
  const lifetime = new Promise<never>((_, reject) => { rejectLifetime = reject; });
  void lifetime.catch(() => undefined);
  const wait = <T,>(promise: Promise<T>) => Promise.race([promise, lifetime]);

  function stopTracks() {
    stream?.getTracks().forEach((track) => {
      track.removeEventListener("ended", ended);
      track.stop();
    });
    stream = undefined;
  }
  function release(error: Error = aborted()) {
    if (disposed) return;
    disposed = true;
    signal.removeEventListener("abort", cancel);
    context.removeEventListener("statechange", stateChanged);
    clearTimeout(flushTimer);
    rejectLifetime(error);
    rejectFlush?.(error);
    resolveFlush = rejectFlush = undefined;
    stopTracks();
    if (processor) {
      processor.port.onmessage = null;
      processor.onprocessorerror = null;
      processor.port.close();
      processor.disconnect();
    }
    source?.disconnect();
    if (!closePromise) {
      closePromise = context.state === "closed" ? Promise.resolve() : context.close();
      void closePromise.catch(() => undefined);
    }
  }
  function cancel() { release(); }
  function fail(code: string) {
    if (disposed) return;
    release(new Error(code));
    input.onError(code);
  }
  function ended() { fail("MIC_ENDED"); }
  function stateChanged() {
    if (resumeComplete && !stopping && !disposed && context.state !== "running") fail("MIC_CAPTURE_ERROR");
  }
  signal.addEventListener("abort", cancel, { once: true });
  context.addEventListener("statechange", stateChanged);

  try {
    if (!context.audioWorklet?.addModule) throw new Error("MIC_UNSUPPORTED");
    // Both calls occur in the original user activation, without an async boundary.
    const resume = context.resume();
    void resume.catch(() => undefined);
    const permission = navigator.mediaDevices.getUserMedia({
      video: false,
      audio: { channelCount: { ideal: 1 }, echoCancellation: { ideal: true }, noiseSuppression: { ideal: true } },
    }).then((next) => {
      if (disposed) { next.getTracks().forEach((track) => track.stop()); throw aborted(); }
      stream = next;
      const tracks = next.getAudioTracks();
      if (!tracks.length || tracks.some((track) => track.readyState === "ended")) {
        throw new Error("MIC_ENDED");
      }
      tracks.forEach((track) => track.addEventListener("ended", ended));
      return next;
    });
    const [readyStream] = await wait(Promise.all([permission, resume]));
    resumeComplete = true;
    if (context.state !== "running") throw new Error("MIC_CAPTURE_ERROR");
    await wait(context.audioWorklet.addModule(workletUrl));
    if (disposed) throw aborted();
    source = context.createMediaStreamSource(readyStream);
    processor = new AudioWorkletNode(context, "ishara-pcm-capture", {
      numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1],
      channelCount: 1, channelCountMode: "explicit",
    });
    processor.onprocessorerror = () => fail("MIC_CAPTURE_ERROR");
    processor.port.onmessage = (event: MessageEvent<unknown>) => {
      if (disposed) return;
      const message = event.data;
      if (!message || typeof message !== "object" || !("type" in message)) { fail("MIC_CAPTURE_ERROR"); return; }
      if (message.type === "audio") {
        if (!started || !("buffer" in message) || !(message.buffer instanceof ArrayBuffer)) { fail("MIC_CAPTURE_ERROR"); return; }
        try { input.onAudio(message.buffer, context.sampleRate); }
        catch { fail("MIC_CAPTURE_ERROR"); }
      } else if (message.type === "flushed") {
        if (!stopping) { fail("MIC_CAPTURE_ERROR"); return; }
        clearTimeout(flushTimer);
        resolveFlush?.();
        resolveFlush = rejectFlush = undefined;
      } else fail("MIC_CAPTURE_ERROR");
    };
    source.connect(processor);
    processor.connect(context.destination);
    return {
      start() {
        if (disposed || stopping || started) return;
        started = true;
        processor!.port.postMessage("start");
      },
      stop() {
        if (stopPromise) return stopPromise;
        if (disposed) return Promise.reject(aborted());
        stopping = true;
        stopTracks();
        stopPromise = (async () => {
          try {
            await new Promise<void>((resolve, reject) => {
              resolveFlush = resolve;
              rejectFlush = reject;
              flushTimer = setTimeout(() => fail("MIC_CAPTURE_ERROR"), 500);
              processor!.port.postMessage("flush");
            });
            release();
            await closePromise;
          } catch (error) {
            release();
            throw error;
          }
        })();
        void stopPromise.catch(() => undefined);
        return stopPromise;
      },
      cancel,
    };
  } catch (error) {
    const wasDisposed = disposed;
    release();
    if (wasDisposed || signal.aborted) throw error;
    if (error instanceof Error && error.message.startsWith("MIC_")) throw error;
    throw new Error(microphoneError(error));
  }
}
