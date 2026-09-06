import { useEffect, useRef, useState } from "react";
import { Icon } from "../../components/Icon";
import { Button } from "../../components/Button";
import { StatusNotice } from "../../components/StatusNotice";
import { useTranslation } from "../../i18n/useTranslation";
import type { TranslationKey } from "../../i18n/types";
import { useVoiceInteraction } from "./useVoiceInteraction";
import { ParticipantSelector } from "../communication/ParticipantSelector";
import { RecognitionResult } from "../communication/RecognitionResult";
import { VoiceControls } from "./VoiceControls";
import { TranscriptPreview } from "./TranscriptPreview";
import { getLiveConfig } from "./tokenClient";
import type { CommunicationSession } from "../communication/model";
import type { SpeechLanguage, SpeechService } from "./service";
export function VoicePanel({ session, service, realService }: {
  session: CommunicationSession; service: SpeechService; realService?: SpeechService;
}) {
  const { locale, t } = useTranslation();
  const [sender, setSender] = useState("participant-2");
  const [speechLanguage, setSpeechLanguage] = useState<SpeechLanguage>("auto");
  const [choice, setChoice] = useState<"real" | "demo" | null>(realService ? null : "demo");
  const [availability, setAvailability] = useState<"checking" | "ready" | "unavailable">(realService ? "checking" : "unavailable");
  const [revision, setRevision] = useState(0);
  const explicitlyChosen = useRef(false);
  useEffect(() => {
    if (!realService) return;
    const controller = new AbortController();
    setAvailability("checking");
    void getLiveConfig(controller.signal).then(({ enabled }) => {
      if (controller.signal.aborted) return;
      setAvailability(enabled ? "ready" : "unavailable");
      if (enabled && !explicitlyChosen.current) setChoice("real");
    }).catch(() => { if (!controller.signal.aborted) setAvailability("unavailable"); });
    return () => controller.abort();
  }, [realService, revision]);
  const real = choice === "real";
  const interaction = useVoiceInteraction(real && realService ? realService : service, session.id, sender, speechLanguage, locale);
  const stateLabels: Record<typeof interaction.status, TranslationKey> = {
    idle: "idle", "requesting-permission": "voicePermission", connecting: "voiceConnecting",
    listening: real ? "realListening" : "listening", finalizing: real ? "voiceFinalizing" : "processing",
    success: real ? "realSuccess" : "success", error: "serviceError",
  };
  const errorKey = real && interaction.error === "emptyResult" ? "voiceEmpty" : interaction.error;
  return <section className="interaction-panel">
    <div className="panel-title"><span className="icon-tile lavender"><Icon name="voice" /></span><div><h2>{t("voicePanelTitle")}</h2><p className="small muted">{t("voiceLimit")}</p></div></div>
    <fieldset className="voice-source" disabled={interaction.busy}>
      <legend>{t("voiceSource")}</legend>
      {realService && <label><input type="radio" name="voice-source" checked={real} disabled={availability !== "ready"} onChange={() => { explicitlyChosen.current = true; setChoice("real"); }} />{t("realVoice")}</label>}
      <label><input type="radio" name="voice-source" checked={choice === "demo"} onChange={() => { explicitlyChosen.current = true; setChoice("demo"); }} />{t("demoVoice")}</label>
    </fieldset>
    {realService && availability !== "ready" && <div className="small muted"><p>{t(availability === "checking" ? "voiceChecking" : "voiceUnavailable")}</p>{availability === "unavailable" && <Button variant="secondary" disabled={interaction.busy} onClick={() => setRevision((value) => value + 1)}>{t("retryVoiceConfig")}</Button>}</div>}
    <p className="prototype-note">{t(real ? "realDisclosure" : choice === "demo" ? "voiceIdleBody" : "chooseVoiceSource")}</p>
    <ParticipantSelector participants={session.participants} value={sender} onChange={setSender} disabled={interaction.busy} />
    <label className="spoken-language">{t("spokenLanguage")}<select value={speechLanguage} disabled={interaction.busy} onChange={(event) => setSpeechLanguage(event.target.value as SpeechLanguage)}><option value="auto">{t("autoLanguage")}</option><option value="en">{t("english")}</option><option value="ar">{t("arabic")}</option></select></label>
    {real && <TranscriptPreview draft={interaction.draft} />}
    {!real && <div className="capture-stage voice-stage"><div className="stage-empty"><span className="voice-orb"><Icon name="voice" size={42} /></span><h3>{t(interaction.status === "listening" ? "listening" : "voiceIdleTitle")}</h3><p>{t("voiceIdleBody")}</p></div></div>}
    <VoiceControls {...interaction} disabled={!choice || (real && availability !== "ready")} />
    <StatusNotice error={!!errorKey}>{t(errorKey ?? stateLabels[interaction.status])}{interaction.status === "success" && interaction.result && <span className="sr-only" lang={interaction.result.language}>{interaction.result.text}</span>}</StatusNotice>
    <RecognitionResult result={interaction.result} />
  </section>;
}
