import { useTranslation } from "../../i18n/useTranslation";
import type { TranscriptDraft } from "./service";
export function TranscriptPreview({ draft }: { draft: TranscriptDraft }) {
  const { t } = useTranslation();
  return <section className="transcript-preview" aria-label={t("draftTranscript")}>
    <h3>{t("draftTranscript")}</h3>
    {draft.finalText && <p dir="auto" lang={draft.language}>{draft.finalText}</p>}
    {draft.interimText && <><span className="small muted">{t("interimTranscript")}</span><p dir="auto">{draft.interimText}</p></>}
    {!draft.finalText && !draft.interimText && <p className="muted">{t("resultEmpty")}</p>}
  </section>;
}
