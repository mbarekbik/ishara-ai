import { useRef, useState } from "react";
import { Button } from "../../components/Button";
import { Icon } from "../../components/Icon";
import { StatusNotice } from "../../components/StatusNotice";
import { useTranslation } from "../../i18n/useTranslation";
import { useCamera } from "./useCamera";
import { useSignInteraction } from "./useSignInteraction";
import { CameraPreview } from "./CameraPreview";
import { RecognitionResult } from "../communication/RecognitionResult";
import { CaptureControls } from "../communication/CaptureControls";
import { ParticipantSelector } from "../communication/ParticipantSelector";
import type { CommunicationSession } from "../communication/model";
import type { SignRecognitionService } from "./service";
export function SignPanel({
  session,
  service,
}: {
  session: CommunicationSession;
  service: SignRecognitionService;
}) {
  const { locale, t } = useTranslation();
  const [sender, setSender] = useState("participant-1");
  const [demo, setDemo] = useState(false);
  const video = useRef<HTMLVideoElement | null>(null);
  const interaction = useSignInteraction(
    service,
    session.id,
    sender,
    locale,
    () => video.current,
  );
  const camera = useCamera(interaction.cancel);
  return (
    <section className="interaction-panel">
      <div className="panel-title">
        <span className="icon-tile">
          <Icon name="sign" />
        </span>
        <div>
          <h2>{t("signPanelTitle")}</h2>
          <p className="small muted">{t("signPanelBody")}</p>
        </div>
      </div>
      <ParticipantSelector
        participants={session.participants}
        value={sender}
        onChange={setSender}
        disabled={interaction.busy}
      />
      <div className={`capture-stage ${demo ? "demo-stage" : ""}`}>
        {camera.stream ? (
          <CameraPreview stream={camera.stream} videoRef={video} />
        ) : (
          <div className="stage-empty">
            <span className="stage-icon">
              <Icon name={demo ? "sign" : "camera"} size={38} />
            </span>
            <h3>{t(demo ? "demoActive" : "cameraOffTitle")}</h3>
            <p>{t(demo ? "demoActiveBody" : "cameraOffBody")}</p>
          </div>
        )}
        <span className="stage-corner" aria-hidden="true" />
        <span className="stage-corner end" aria-hidden="true" />
      </div>
      <div className="camera-actions">
        {camera.status === "ready" ? (
          <Button variant="quiet" onClick={camera.stop}>
            {t("disableCamera")}
          </Button>
        ) : (
          <Button
            variant="secondary"
            disabled={camera.status === "requesting" || interaction.busy}
            onClick={() => {
              setDemo(false);
              void camera.request();
            }}
          >
            <Icon name="camera" size={18} />
            {t(camera.status === "error" ? "retryCamera" : "enableCamera")}
          </Button>
        )}
        <Button
          variant="quiet"
          aria-pressed={demo}
          onClick={() => {
            if (demo) return;
            camera.stop();
            setDemo(true);
          }}
        >
          {t("demoFallback")}
        </Button>
      </div>
      {camera.status === "requesting" && (
        <StatusNotice>{t("cameraRequesting")}</StatusNotice>
      )}
      {camera.error && <StatusNotice error>{t(camera.error)}</StatusNotice>}
      <CaptureControls
        mode="sign"
        {...interaction}
        enabled={demo || camera.status === "ready"}
      />
      <StatusNotice error={!!interaction.error}>
        {t(
          interaction.error ??
            (interaction.status === "error"
              ? "serviceError"
              : interaction.status),
        )}
        {interaction.status === "success" && interaction.result && (
          <span className="sr-only" lang={interaction.result.language}>
            {interaction.result.text}
          </span>
        )}
      </StatusNotice>
      <RecognitionResult result={interaction.result} />
    </section>
  );
}
