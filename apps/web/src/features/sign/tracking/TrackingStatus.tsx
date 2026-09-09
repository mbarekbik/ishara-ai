import { useEffect, useState, type RefObject } from "react";
import { Button } from "../../../components/Button";
import { StatusNotice } from "../../../components/StatusNotice";
import { useTranslation } from "../../../i18n/useTranslation";
import type { LandmarkFrame, TrackingErrorCode, TrackingStatus as Status } from "./model";

type Guidance = "trackingNoPerson" | "trackingNoHands" | "trackingOneHand" | "trackingTwoHands";
export function TrackingStatus({ status, error, frameRef, pause, resume, retry }: {
  status: Status; error: TrackingErrorCode | null; frameRef: RefObject<LandmarkFrame | null>;
  pause: () => void; resume: () => void; retry: () => void;
}) {
  const { t } = useTranslation();
  const [guidance, setGuidance] = useState<Guidance | null>(null);
  const [announcement, setAnnouncement] = useState<Guidance | null>(null);
  useEffect(() => {
    setGuidance(null); setAnnouncement(null);
    if (status !== "tracking") return;
    let candidate: Guidance | null = null;
    let since = 0;
    let lastAnnouncement = -Infinity;
    let announced: Guidance | null = null;
    const timer = setInterval(() => {
      const frame = frameRef.current;
      if (!frame) {
        candidate = null; announced = null;
        setGuidance(null); setAnnouncement(null);
        return;
      }
      const count = Number(!!frame.leftHand) + Number(!!frame.rightHand);
      const next: Guidance = count === 2 ? "trackingTwoHands" : count === 1 ? "trackingOneHand" : !frame.pose && !frame.face ? "trackingNoPerson" : "trackingNoHands";
      const now = performance.now();
      if (candidate !== next) { candidate = next; since = now; return; }
      if (now - since < 1_000) return;
      setGuidance(next);
      if (next !== announced && now - lastAnnouncement >= 5_000) {
        announced = next; lastAnnouncement = now; setAnnouncement(next);
      }
    }, 250);
    return () => clearInterval(timer);
  }, [status, frameRef]);
  const statusKey = status === "loading" || status === "ready" ? "trackingLoading" : status === "paused" ? "trackingPaused" : status === "tracking" ? "trackingActive" : "trackingIdle";
  return <div className="tracking-status">
    <StatusNotice error={!!error}>{t(error ?? statusKey)}</StatusNotice>
    {guidance && <p className="small tracking-guidance">{t(guidance)}</p>}
    <span role="status" aria-atomic="true" className="sr-only">{announcement && t(announcement)}</span>
    <div className="tracking-actions">
      {(status === "loading" || status === "ready" || status === "tracking") && <Button variant="quiet" onClick={pause}>{t("pauseTracking")}</Button>}
      {status === "paused" && <Button variant="secondary" onClick={resume}>{t("resumeTracking")}</Button>}
      {status === "error" && <Button variant="secondary" onClick={retry}>{t("retryTracking")}</Button>}
    </div>
  </div>;
}
