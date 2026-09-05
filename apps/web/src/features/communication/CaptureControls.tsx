import { useEffect, useRef } from "react";
import { Button } from "../../components/Button";
import { Icon } from "../../components/Icon";
import { useTranslation } from "../../i18n/useTranslation";
import type { CommunicationMode, InteractionStatus } from "./model";
export function CaptureControls({
  mode,
  status,
  enabled = true,
  start,
  finish,
  cancel,
}: {
  mode: CommunicationMode;
  status: InteractionStatus;
  enabled?: boolean;
  start: () => Promise<void>;
  finish: () => Promise<void>;
  cancel: () => void;
}) {
  const { t } = useTranslation();
  const startButton = useRef<HTMLButtonElement>(null);
  const busy =
    status === "capturing" || status === "listening" || status === "processing";
  const wasBusy = useRef(busy);
  useEffect(() => {
    if (wasBusy.current && !busy && document.activeElement === document.body)
      startButton.current?.focus();
    wasBusy.current = busy;
  }, [busy]);
  return (
    <div className="capture-controls">
      {busy ? (
        <>
          {status !== "processing" && (
            <Button onClick={() => void finish()}>
              <Icon name="stop" size={18} />
              {t(mode === "sign" ? "stopSign" : "stopVoice")}
            </Button>
          )}
          <Button variant="secondary" onClick={cancel}>
            {t("cancel")}
          </Button>
        </>
      ) : (
        <Button
          ref={startButton}
          disabled={!enabled}
          onClick={() => void start()}
        >
          <Icon name={mode} size={20} />
          {t(mode === "sign" ? "startSign" : "startVoice")}
        </Button>
      )}
    </div>
  );
}
