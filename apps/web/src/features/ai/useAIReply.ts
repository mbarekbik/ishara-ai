import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSessionStore } from "../communication/sessionStore";
import { createId } from "../communication/createId";
import type { Message } from "../communication/model";
import type { RecognitionResult } from "../communication/interaction";
import { selectAIContext } from "./context";
import { AIError, normalizeAIError, validateAIResult, type AIService, type ResponseLanguage } from "./service";

type AIStatus = "idle" | "generating" | "success" | "error";
interface Run {
  id: string;
  sessionId: string;
  messages: readonly Message[];
  messageIds: string;
  source: AIService["kind"];
  language: ResponseLanguage;
  controller: AbortController;
  timer?: ReturnType<typeof setTimeout>;
}
const EMPTY_MESSAGES: Message[] = [];

export function useAIReply(service: AIService, sessionId: string, responseLanguage: ResponseLanguage) {
  const [status, setStatus] = useState<AIStatus>("idle");
  const [error, setError] = useState<AIError | null>(null);
  const [result, setResult] = useState<RecognitionResult | null>(null);
  const active = useRef<Run | null>(null);
  const history = useSessionStore((state) => state.session?.id === sessionId ? state.session.messages : EMPTY_MESSAGES);
  const selection = useMemo(() => {
    try { return { context: selectAIContext(history), contextError: null }; }
    catch (failure) { return { context: null, contextError: normalizeAIError(failure) }; }
  }, [history]);
  const discard = useCallback(() => {
    const run = active.current;
    active.current = null;
    if (run) { clearTimeout(run.timer); run.controller.abort(); }
  }, []);
  const cancel = useCallback(() => {
    discard(); setStatus("idle"); setError(null); setResult(null);
  }, [discard]);
  useEffect(() => {
    const hidden = () => { if (document.hidden) cancel(); };
    document.addEventListener("visibilitychange", hidden);
    window.addEventListener("pagehide", cancel);
    const unsubscribe = useSessionStore.subscribe((state) => {
      const run = active.current;
      if (!run) return;
      if (state.session?.id !== run.sessionId) { cancel(); return; }
      if (state.session.messages !== run.messages || JSON.stringify(state.session.messages.map((message) => message.id)) !== run.messageIds) {
        discard(); setStatus("error"); setError(new AIError("AI_CONVERSATION_CHANGED", true));
      }
    });
    return () => {
      discard(); unsubscribe();
      document.removeEventListener("visibilitychange", hidden);
      window.removeEventListener("pagehide", cancel);
    };
  }, [cancel, discard, sessionId]);

  const start = async () => {
    if (active.current) return;
    const session = useSessionStore.getState().session;
    if (!session || session.id !== sessionId) return;
    let context;
    try { context = selectAIContext(session.messages); }
    catch (failure) { setError(normalizeAIError(failure)); setStatus("error"); return; }
    const run: Run = {
      id: createId(), sessionId, messages: session.messages,
      messageIds: JSON.stringify(session.messages.map((message) => message.id)),
      source: service.kind, language: responseLanguage, controller: new AbortController(),
    };
    active.current = run; setStatus("generating"); setError(null); setResult(null);
    const current = () => {
      const next = useSessionStore.getState().session;
      return active.current === run && !run.controller.signal.aborted && next?.id === run.sessionId &&
        next.messages === run.messages && JSON.stringify(next.messages.map((message) => message.id)) === run.messageIds;
    };
    let timedOut = false;
    const timeout = () => { timedOut = true; run.controller.abort(); };
    run.timer = setTimeout(timeout, 25_000);
    let rejectAbort: (() => void) | undefined;
    const cancelled = new Promise<never>((_resolve, reject) => {
      rejectAbort = () => reject(new DOMException("Cancelled", "AbortError"));
      run.controller.signal.addEventListener("abort", rejectAbort, { once: true });
    });
    try {
      const output = await Promise.race([cancelled, service.reply({
        messages: context.messages, responseLanguage: run.language, signal: run.controller.signal,
      })]);
      if (!current()) return;
      validateAIResult(output, run.source, run.language);
      // Invalidate first: our own append must not trigger conversation-change cancellation.
      discard();
      const appended = useSessionStore.getState().append(run.sessionId, {
        id: run.id, sender: { id: "assistant", kind: "assistant" }, inputType: "ai",
        text: output.text, language: output.language, source: run.source, createdAt: new Date().toISOString(),
      });
      if (appended) { setResult(output); setStatus("success"); }
      else { setError(new AIError("AI_CONVERSATION_CHANGED", true)); setStatus("error"); }
    } catch (failure) {
      if (active.current === run) {
        discard(); setError(timedOut ? new AIError("AI_TIMEOUT", true) : normalizeAIError(failure)); setStatus("error");
      }
    } finally {
      if (rejectAbort) run.controller.signal.removeEventListener("abort", rejectAbort);
      clearTimeout(run.timer);
      if (active.current === run) discard();
    }
  };
  return { status, error, result, busy: status === "generating", start, cancel,
    ...selection, eligible: selection.context !== null };
}
