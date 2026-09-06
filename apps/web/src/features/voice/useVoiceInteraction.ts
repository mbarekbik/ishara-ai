import { useCallback, useEffect, useRef, useState } from "react";
import type { SpeechLanguage, SpeechService, TranscriptDraft, VoiceStatus } from "./service";
import { voiceError, type VoiceErrorCode } from "./errors";
import type { CaptureOperation, RecognitionResult } from "../communication/interaction";
import { useSessionStore } from "../communication/sessionStore";
import { createId } from "../communication/createId";
const emptyDraft = (): TranscriptDraft => ({ finalText: "", interimText: "", language: "und" });
interface Run { id: string; sessionId: string; senderId: string; controller: AbortController; operation?: CaptureOperation; finishing: boolean; stopRequested: boolean; timer?: ReturnType<typeof setTimeout> }
export function useVoiceInteraction(service: SpeechService, sessionId: string, senderId: string, speechLanguage: SpeechLanguage, locale = "en") {
  const [status, setStatus] = useState<VoiceStatus>("idle");
  const [error, setError] = useState<VoiceErrorCode | null>(null);
  const [result, setResult] = useState<RecognitionResult | null>(null);
  const [draft, setDraft] = useState(emptyDraft);
  const active = useRef<Run | null>(null);
  const discard = useCallback(() => {
    const run = active.current; active.current = null;
    if (run) { clearTimeout(run.timer); run.controller.abort(); run.operation?.cancel(); }
  }, []);
  const cancel = useCallback(() => { discard(); setStatus("idle"); setError(null); setDraft(emptyDraft()); }, [discard]);
  useEffect(() => {
    const hidden = () => { if (document.hidden) cancel(); };
    document.addEventListener("visibilitychange", hidden);
    window.addEventListener("pagehide", cancel);
    const unsubscribe = useSessionStore.subscribe((state) => { if (active.current && state.session?.id !== active.current.sessionId) cancel(); });
    return () => { discard(); unsubscribe(); document.removeEventListener("visibilitychange", hidden); window.removeEventListener("pagehide", cancel); };
  }, [cancel, discard, service, sessionId]);
  const current = (run: Run) => active.current === run && !run.controller.signal.aborted && useSessionStore.getState().session?.id === run.sessionId;
  const fail = (run: Run, failure: unknown) => {
    if (!current(run)) return;
    discard(); setDraft(emptyDraft()); setStatus("error");
    setError(voiceError(failure, service.kind === "service" ? "LIVE_CONNECTION_ERROR" : "serviceError"));
  };
  const finish = async (run: Run) => {
    if (!current(run) || run.finishing || !run.operation) return;
    run.finishing = true; clearTimeout(run.timer); setStatus("finalizing");
    try {
      const output = await run.operation.finish();
      if (!current(run)) return;
      if (!output.text.trim()) { fail(run, "emptyResult"); return; }
      const appended = useSessionStore.getState().append(run.sessionId, {
        ...output, id: run.id, sender: { id: run.senderId, kind: "human" }, inputType: "voice", createdAt: new Date().toISOString(),
      });
      if (appended) { setResult(output); setStatus("success"); setDraft(emptyDraft()); }
      discard();
    } catch (failure) { fail(run, failure); }
  };
  const stop = async () => {
    const run = active.current; if (!run) return;
    run.stopRequested = true; setStatus("finalizing"); await finish(run);
  };
  const start = async () => {
    if (active.current) return;
    const run: Run = { id: createId(), sessionId, senderId, controller: new AbortController(), finishing: false, stopRequested: false };
    active.current = run; setError(null); setResult(null); setDraft(emptyDraft());
    setStatus(service.kind === "service" ? "requesting-permission" : "listening");
    try {
      const operation = await service.begin({
        language: speechLanguage === "auto" ? locale : speechLanguage, speechLanguage, signal: run.controller.signal,
        onPhase: (phase) => { if (current(run) && !run.stopRequested) setStatus(phase); },
        onDraft: (next) => { if (current(run)) setDraft(next); },
        onError: (code) => fail(run, code),
      });
      if (!current(run)) { operation.cancel(); return; }
      run.operation = operation;
      run.timer = setTimeout(() => { void finish(run); }, 120_000);
      if (run.stopRequested) await finish(run);
    } catch (failure) { fail(run, failure); }
  };
  return { status, error, result, draft, start, stop, cancel, busy: ["requesting-permission", "connecting", "listening", "finalizing"].includes(status) };
}
