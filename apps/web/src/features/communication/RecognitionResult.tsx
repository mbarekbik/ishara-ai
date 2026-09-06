import { useTranslation } from "../../i18n/useTranslation";
import type { RecognitionResult as Result } from "./interaction";
export function RecognitionResult({ result }: { result: Result | null }) {
  const { t } = useTranslation();
  return (
    <section className="recognition-result" aria-labelledby="result-heading">
      <div className="section-label">
        <h3 id="result-heading">{t("resultTitle")}</h3>
        {result && <span className="pill">{t(result.source === "mock" ? "mock" : "transcribed")}</span>}
      </div>
      {result ? (
        <>
          <p className="result-text" lang={result.language} dir="auto">
            {result.text}
          </p>
          <p className="small muted">{t(result.source === "mock" ? "resultHint" : "transcriptReview")}</p>
        </>
      ) : (
        <p className="muted">{t("resultEmpty")}</p>
      )}
    </section>
  );
}
