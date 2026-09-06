import { useEffect, useRef } from "react";
import { Button } from "../../components/Button";
import { useTranslation } from "../../i18n/useTranslation";
import type { VoiceStatus } from "./service";
export function VoiceControls({ status, busy, disabled, start, stop, cancel }: {
  status: VoiceStatus; busy: boolean; disabled: boolean; start: () => Promise<void>; stop: () => Promise<void>; cancel: () => void;
}) {
  const { t } = useTranslation();
  const startButton = useRef<HTMLButtonElement>(null);
  const wasBusy = useRef(false);
  useEffect(() => {
    if (wasBusy.current && !busy && document.activeElement === document.body) startButton.current?.focus();
    wasBusy.current = busy;
  }, [busy]);
  return <div className="capture-controls">
    <Button ref={startButton} disabled={busy || disabled} onClick={() => void start()}>{t("startVoice")}</Button>
    {status === "listening" && <Button onClick={() => void stop()}>{t("stopVoice")}</Button>}
    {busy && <Button variant="secondary" onClick={cancel}>{t("cancel")}</Button>}
  </div>;
}
