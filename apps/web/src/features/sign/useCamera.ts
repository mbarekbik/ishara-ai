import { useCallback, useEffect, useRef, useState } from "react";
import type { CameraStatus } from "../communication/model";
type CameraError =
  | "cameraDenied"
  | "cameraMissing"
  | "cameraBusy"
  | "cameraUnsupported"
  | "cameraUnexpected"
  | "cameraEnded";
export function useCamera(onRelease: () => void) {
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [status, setStatus] = useState<CameraStatus>("off");
  const [error, setError] = useState<CameraError | null>(null);
  const owned = useRef<MediaStream | null>(null);
  const generation = useRef(0);
  const pending = useRef(false);
  const removeListeners = useRef<(() => void) | null>(null);
  const dispose = useCallback(() => {
    generation.current++;
    pending.current = false;
    removeListeners.current?.();
    removeListeners.current = null;
    owned.current?.getTracks().forEach((track) => track.stop());
    owned.current = null;
  }, []);
  const stop = useCallback(() => {
    dispose();
    setStream(null);
    setStatus("off");
    setError(null);
    onRelease();
  }, [dispose, onRelease]);
  useEffect(() => {
    const hidden = () => {
      if (document.hidden) stop();
    };
    document.addEventListener("visibilitychange", hidden);
    window.addEventListener("pagehide", stop);
    return () => {
      document.removeEventListener("visibilitychange", hidden);
      window.removeEventListener("pagehide", stop);
      dispose();
    };
  }, [dispose, stop]);
  const request = async () => {
    if (pending.current || owned.current) return;
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
      setError("cameraUnsupported");
      setStatus("error");
      return;
    }
    const token = ++generation.current;
    pending.current = true;
    setStatus("requesting");
    setError(null);
    try {
      const next = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          facingMode: "user",
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
      });
      if (generation.current !== token) {
        next.getTracks().forEach((track) => track.stop());
        return;
      }
      pending.current = false;
      owned.current = next;
      const ended = () => {
        stop();
        setStatus("error");
        setError("cameraEnded");
      };
      const tracks = next.getVideoTracks();
      tracks.forEach((track) => track.addEventListener("ended", ended));
      removeListeners.current = () =>
        tracks.forEach((track) => track.removeEventListener("ended", ended));
      if (
        !tracks.length ||
        tracks.some((track) => track.readyState === "ended")
      ) {
        ended();
        return;
      }
      setStream(next);
      setStatus("ready");
    } catch (cause) {
      if (generation.current !== token) return;
      pending.current = false;
      const name = cause instanceof DOMException ? cause.name : "";
      const code: CameraError =
        name === "NotAllowedError"
          ? "cameraDenied"
          : name === "NotFoundError"
            ? "cameraMissing"
            : name === "NotReadableError" || name === "AbortError"
              ? "cameraBusy"
              : name === "SecurityError"
                ? "cameraUnsupported"
                : "cameraUnexpected";
      setError(code);
      setStatus("error");
    }
  };
  return { stream, status, error, request, stop };
}
