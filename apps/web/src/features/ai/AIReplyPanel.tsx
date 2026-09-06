import { useEffect, useRef, useState } from "react";
import { Button } from "../../components/Button";
import { Icon } from "../../components/Icon";
import { StatusNotice } from "../../components/StatusNotice";
import { useTranslation } from "../../i18n/useTranslation";
import { useAIReply } from "./useAIReply";
import type { AIService, ResponseLanguage } from "./service";

export function AIReplyPanel({ service, realService, sessionId }: {
  service: AIService;
  realService?: AIService;
  sessionId: string;
}) {
  const { t, locale } = useTranslation();
  const [source, setSource] = useState<"real" | "demo">(realService ? "real" : "demo");
  const [responseLanguage, setResponseLanguage] = useState<ResponseLanguage>("auto");
  const [availability, setAvailability] = useState<"checking" | "ready" | "unavailable">(realService ? "checking" : "unavailable");
  const [configRevision, setConfigRevision] = useState(0);
  const askButton = useRef<HTMLButtonElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const real = source === "real";
  const reply = useAIReply(real && realService ? realService : service, sessionId, responseLanguage);
  const wasBusy = useRef(false);

  useEffect(() => {
    if (!realService) return;
    const controller = new AbortController();
    setAvailability("checking");
    if (!realService.getConfig) {
      setAvailability("unavailable");
      return () => controller.abort();
    }
    void realService.getConfig(controller.signal).then((config) => {
      if (!controller.signal.aborted) setAvailability(config.enabled ? "ready" : "unavailable");
    }).catch(() => {
      if (!controller.signal.aborted) setAvailability("unavailable");
    });
    return () => controller.abort();
  }, [realService, configRevision]);

  useEffect(() => {
    if (wasBusy.current && !reply.busy && document.activeElement === document.body) {
      (reply.eligible ? askButton.current : heading.current)?.focus({ preventScroll: true });
    }
    wasBusy.current = reply.busy;
  }, [reply.busy, reply.eligible]);

  const error = reply.error ?? (reply.contextError?.code === "AI_NO_HUMAN_MESSAGE" ? null : reply.contextError);
  const number = new Intl.NumberFormat(locale);
  return (
    <section className="assistant-actions" aria-labelledby="assistant-heading">
      <h3 ref={heading} tabIndex={-1} id="assistant-heading"><Icon name="spark" size={18} />{t("aiTitle")}</h3>
      <fieldset className="ai-source" disabled={reply.busy}>
        <legend>{t("aiSource")}</legend>
        {realService && <label><input type="radio" name="ai-source" checked={real} onChange={() => { reply.cancel(); setSource("real"); }} />{t("aiReal")}</label>}
        <label><input type="radio" name="ai-source" checked={!real} onChange={() => { reply.cancel(); setSource("demo"); }} />{t("aiDemo")}</label>
      </fieldset>
      {real && availability !== "ready" && (
        <div className="small muted">
          <p>{t(availability === "checking" ? "aiChecking" : "aiUnavailable")}</p>
          {availability === "unavailable" && <Button variant="secondary" disabled={reply.busy} onClick={() => setConfigRevision((value) => value + 1)}>{t("aiRetryConfig")}</Button>}
        </div>
      )}
      <p className="small ai-disclosure">{t(real ? "aiDisclosure" : "aiNote")}</p>
      <label className="ai-language">{t("aiResponseLanguage")}
        <select value={responseLanguage} disabled={reply.busy} onChange={(event) => setResponseLanguage(event.target.value as ResponseLanguage)}>
          <option value="auto">{t("autoLanguage")}</option>
          <option value="en">{t("english")}</option>
          <option value="ar">{t("arabic")}</option>
        </select>
      </label>
      {reply.context && real && <p className="small muted">{t("aiContextCount")}: {number.format(reply.context.messages.length)}.{reply.context.omittedCount > 0 && <> {t("aiContextOmitted")}: {number.format(reply.context.omittedCount)}.</>}</p>}
      {!reply.eligible && !error && <p className="small muted">{t("aiNeedsHuman")}</p>}
      <div className="ai-controls">
        <Button ref={askButton} variant="secondary" disabled={!reply.eligible || reply.busy || (real && availability !== "ready")} onClick={() => void reply.start()}>
          <Icon name="spark" size={18} />{t("aiReply")}
        </Button>
        {reply.busy && <Button variant="quiet" onClick={reply.cancel}>{t("cancel")}</Button>}
      </div>
      {error && <StatusNotice error>{t(error.code)}{error.retryAfterSeconds !== undefined && <> {t("aiRetryAfter")}: {number.format(error.retryAfterSeconds)} {t("aiSeconds")}.</>}</StatusNotice>}
      {!error && reply.busy && <StatusNotice>{t(real ? "aiBusy" : "aiDemoBusy")}</StatusNotice>}
      {!error && reply.status === "success" && <StatusNotice>{t(real ? "aiSuccess" : "aiDemoSuccess")}</StatusNotice>}
    </section>
  );
}
