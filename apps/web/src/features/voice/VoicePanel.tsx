import { useState } from "react";
import { Icon } from "../../components/Icon";
import { StatusNotice } from "../../components/StatusNotice";
import { useTranslation } from "../../i18n/useTranslation";
import { useVoiceInteraction } from "./useVoiceInteraction";
import { ParticipantSelector } from "../communication/ParticipantSelector";
import { RecognitionResult } from "../communication/RecognitionResult";
import { CaptureControls } from "../communication/CaptureControls";
import type { CommunicationSession } from "../communication/model";
import type { SpeechService } from "./service";
export function VoicePanel({
  session,
  service,
}: {
  session: CommunicationSession;
  service: SpeechService;
}) {
  const { locale, t } = useTranslation();
  const [sender, setSender] = useState("participant-2");
  const interaction = useVoiceInteraction(service, session.id, sender, locale);
  return (
    <section className="interaction-panel">
      <div className="panel-title">
        <span className="icon-tile lavender">
          <Icon name="voice" />
        </span>
        <div>
          <h2>{t("voicePanelTitle")}</h2>
          <p className="small muted">{t("voicePanelBody")}</p>
        </div>
      </div>
      <ParticipantSelector
        participants={session.participants}
        value={sender}
        onChange={setSender}
        disabled={interaction.busy}
      />
      <div
        className={`capture-stage voice-stage ${interaction.status === "listening" ? "is-listening" : ""}`}
      >
        <div className="stage-empty">
          <span className="voice-orb">
            <Icon name="voice" size={42} />
          </span>
          <h3>
            {t(
              interaction.status === "listening"
                ? "listening"
                : "voiceIdleTitle",
            )}
          </h3>
          <p>{t("voiceIdleBody")}</p>
        </div>
      </div>
      <CaptureControls mode="voice" {...interaction} />
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
