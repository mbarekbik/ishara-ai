import { useCallback, useEffect, useRef, useState } from "react";
import { useSessionStore } from "./sessionStore";
import { createId } from "./createId";
import type {
  CaptureOperation,
  InteractionError,
  RecognitionResult,
} from "./interaction";
import type {
  InteractionStatus,
  MessageInputType,
  MessageSender,
} from "./model";
interface Running {
  id: string;
  sessionId: string;
  sender: MessageSender;
  controller: AbortController;
  operation?: CaptureOperation;
  finishing: boolean;
  stopRequested: boolean;
}
interface Options {
  sessionId: string;
  sender: MessageSender;
  language: string;
  inputType: MessageInputType;
  phase: "capturing" | "listening" | "processing";
  begin: (language: string, signal: AbortSignal) => Promise<CaptureOperation>;
  autoFinish?: boolean;
}
export function useCaptureInteraction({
  sessionId,
  sender,
  language,
  inputType,
  phase,
  begin,
  autoFinish,
}: Options) {
  const [status, setStatus] = useState<InteractionStatus>("idle");
  const [error, setError] = useState<InteractionError | null>(null);
  const [result, setResult] = useState<RecognitionResult | null>(null);
  const active = useRef<Running | null>(null);
  const discard = useCallback(() => {
    const current = active.current;
    active.current = null;
    current?.controller.abort();
    current?.operation?.cancel();
  }, []);
  useEffect(() => discard, [discard]);
  const cancel = useCallback(() => {
    discard();
    setStatus("idle");
    setError(null);
  }, [discard]);
  const isCurrent = (run: Running) =>
    active.current === run &&
    !run.controller.signal.aborted &&
    useSessionStore.getState().session?.id === run.sessionId;
  const complete = async (run: Running) => {
    if (run.finishing || !run.operation || !isCurrent(run)) return;
    run.finishing = true;
    setStatus("processing");
    try {
      const output = await run.operation.finish();
      if (!isCurrent(run)) return;
      if (!output.text.trim()) {
        setError("emptyResult");
        setStatus("error");
        return;
      }
      const appended = useSessionStore.getState().append(run.sessionId, {
        id: run.id,
        sender: run.sender,
        inputType,
        ...output,
        createdAt: new Date().toISOString(),
      });
      if (appended) {
        setResult(output);
        setStatus("success");
      }
    } catch {
      if (isCurrent(run)) {
        setError("serviceError");
        setStatus("error");
      }
    } finally {
      if (active.current === run) {
        active.current = null;
        run.controller.abort();
        run.operation.cancel();
      }
    }
  };
  const start = async () => {
    if (active.current) return;
    const run: Running = {
      id: createId(),
      sessionId,
      sender: { ...sender },
      controller: new AbortController(),
      finishing: false,
      stopRequested: false,
    };
    active.current = run;
    setStatus(phase);
    setError(null);
    setResult(null);
    try {
      const operation = await begin(language, run.controller.signal);
      if (!isCurrent(run)) {
        operation.cancel();
        return;
      }
      run.operation = operation;
      if (autoFinish || run.stopRequested) await complete(run);
    } catch {
      if (isCurrent(run)) {
        active.current = null;
        run.controller.abort();
        setError("serviceError");
        setStatus("error");
      }
    }
  };
  const finish = async () => {
    if (!active.current) return;
    active.current.stopRequested = true;
    setStatus("processing");
    await complete(active.current);
  };
  return {
    status,
    error,
    result,
    start,
    finish,
    cancel,
    busy:
      status === "capturing" ||
      status === "listening" ||
      status === "processing",
  };
}
