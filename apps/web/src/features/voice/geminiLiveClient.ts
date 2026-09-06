/** Gemini protocol transport. Transcript assembly and commitment belong to callers. */
export interface ProtocolCredential {
  token: string;
  apiVersion: "v1beta";
  model: "gemini-3.5-transcribe-live";
  newSessionExpiresAt: string;
  expiresAt: string;
}
export type ProtocolObservation =
  | { kind: "interim" | "final"; text: string; language?: string; finished?: boolean }
  | { kind: "model-turn-complete" };
type SocketFactory = (url: string) => WebSocket;
const object = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === "object" && !Array.isArray(value);

export function openGeminiLiveClient(input: {
  credential: ProtocolCredential;
  signal: AbortSignal;
  onObservation: (event: ProtocolObservation) => void;
  onError: (code: string) => void;
  socketFactory?: SocketFactory;
}) {
  const { credential, signal } = input;
  const deadline = Date.parse(credential.newSessionExpiresAt);
  const expiry = Date.parse(credential.expiresAt);
  if (credential.apiVersion !== "v1beta" || credential.model !== "gemini-3.5-transcribe-live" ||
      !credential.token.startsWith("auth_tokens/") || !Number.isFinite(deadline) || deadline <= Date.now() ||
      !Number.isFinite(expiry) || expiry <= Date.now()) throw new Error("LIVE_CREDENTIAL_INVALID");
  if (signal.aborted) throw new DOMException("Cancelled", "AbortError");
  let disposed = false;
  let setupComplete = false;
  let active = false;
  let ended = false;
  let resolveReady!: () => void;
  let rejectReady!: (error: Error) => void;
  const ready = new Promise<void>((resolve, reject) => { resolveReady = resolve; rejectReady = reject; });
  // Cancellation can occur before the caller begins awaiting setup.
  void ready.catch(() => undefined);
  const socket = (input.socketFactory ?? ((url) => new WebSocket(url)))(
    "wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContentConstrained?access_token=" + encodeURIComponent(credential.token),
  );
  let decoding = Promise.resolve();
  const timer = setTimeout(() => fail("LIVE_SETUP_TIMEOUT"), 10_000);
  const expiryTimer = setTimeout(() => fail("LIVE_EXPIRED"), expiry - Date.now());
  function close() {
    if (disposed) return;
    disposed = true;
    clearTimeout(timer); clearTimeout(expiryTimer);
    signal.removeEventListener("abort", close);
    socket.onopen = socket.onmessage = socket.onerror = socket.onclose = null;
    rejectReady(new DOMException("Cancelled", "AbortError"));
    socket.close();
  }
  function fail(code: string) {
    if (disposed) return;
    rejectReady(new Error(code));
    close();
    input.onError(code);
  }
  function send(value: unknown) {
    if (disposed || socket.readyState !== 1) throw new Error("LIVE_NOT_CONNECTED");
    try { socket.send(JSON.stringify(value)); } catch { fail("LIVE_CONNECTION_ERROR"); throw new Error("LIVE_CONNECTION_ERROR"); }
  }
  socket.onopen = () => {
    if (disposed) return;
    // The token locks the entire setup; no browser-side configuration override.
    try { send({ setup: {} }); } catch { /* fail already reported */ }
  };
  socket.onerror = () => fail("LIVE_CONNECTION_ERROR");
  socket.onclose = () => fail("LIVE_CONNECTION_CLOSED");
  socket.onmessage = (message) => {
    // Blob decoding may be asynchronous. Preserve WebSocket delivery order.
    decoding = decoding.then(async () => {
      if (disposed) return;
      const data: unknown = message.data;
      const raw = typeof data === "string" ? data : data instanceof Blob ? await data.text() : undefined;
      if (disposed) return;
      if (raw === undefined || raw.length > 262_144) throw new Error("INVALID_EVENT");
      const event: unknown = JSON.parse(raw);
      if (!object(event)) throw new Error("INVALID_EVENT");
      if (event.error || event.goAway) { fail("LIVE_SESSION_INTERRUPTED"); return; }
      if ("setupComplete" in event && !setupComplete) {
        setupComplete = true; clearTimeout(timer); resolveReady();
      }
      if (!object(event.serverContent)) return;
      const content = event.serverContent;
      for (const [field, kind] of [["interimInputTranscription", "interim"], ["inputTranscription", "final"]] as const) {
        if (!(field in content)) continue;
        const transcript = content[field];
        if (!object(transcript) || (transcript.text !== undefined && typeof transcript.text !== "string") ||
            (transcript.finished !== undefined && typeof transcript.finished !== "boolean") ||
            (transcript.languageCode !== undefined && typeof transcript.languageCode !== "string")) throw new Error("INVALID_EVENT");
        input.onObservation({ kind, text: transcript.text as string ?? "", language: transcript.languageCode as string | undefined, finished: transcript.finished as boolean | undefined });
      }
      // Observation only: this is NOT a barrier for input transcription.
      if (content.turnComplete === true) input.onObservation({ kind: "model-turn-complete" });
    }).catch(() => fail("LIVE_INVALID_EVENT"));
  };
  signal.addEventListener("abort", close, { once: true });
  if (signal.aborted) close();
  return {
    ready, close,
    start() {
      if (!setupComplete || disposed) throw new Error("LIVE_NOT_CONNECTED");
      if (active || ended) return;
      send({ realtimeInput: { activityStart: {} } }); active = true;
    },
    sendAudio(pcm: ArrayBuffer, sampleRate: number) {
      if (!active || ended || disposed) throw new Error("LIVE_NOT_LISTENING");
      if (!Number.isInteger(sampleRate) || sampleRate < 8000 || sampleRate > 192000 || pcm.byteLength % 2 || pcm.byteLength > sampleRate * 2) throw new Error("LIVE_INVALID_AUDIO");
      let bytes = "";
      for (const byte of new Uint8Array(pcm)) bytes += String.fromCharCode(byte);
      const message = { realtimeInput: { audio: { data: btoa(bytes), mimeType: `audio/pcm;rate=${sampleRate}` } } };
      if (socket.bufferedAmount + JSON.stringify(message).length > Math.ceil(sampleRate * 2 * 4 / 3) + 1024) {
        fail("LIVE_CONNECTION_TOO_SLOW"); throw new Error("LIVE_CONNECTION_TOO_SLOW");
      }
      send(message);
    },
    end() {
      if (!active || ended || disposed) return;
      ended = true; send({ realtimeInput: { activityEnd: {} } });
    },
  };
}
