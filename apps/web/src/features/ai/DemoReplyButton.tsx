import { Button } from "../../components/Button";
import { Icon } from "../../components/Icon";
import { StatusNotice } from "../../components/StatusNotice";
import { useTranslation } from "../../i18n/useTranslation";
import { useDemoReply } from "./useDemoReply";
import type { AIService } from "./service";
export function DemoReplyButton({
  service,
  sessionId,
  enabled,
}: {
  service: AIService;
  sessionId: string;
  enabled: boolean;
}) {
  const { t, locale } = useTranslation();
  const reply = useDemoReply(service, sessionId, locale);
  return (
    <div className="assistant-actions">
      <Button
        variant="secondary"
        disabled={!enabled || reply.busy}
        onClick={() => void reply.start()}
      >
        <Icon name="spark" size={18} />
        {t("aiReply")}
      </Button>
      {reply.busy && (
        <Button variant="quiet" onClick={reply.cancel}>
          {t("cancel")}
        </Button>
      )}
      <p className="small muted">{t("aiNote")}</p>
      {reply.status !== "idle" && (
        <StatusNotice error={!!reply.error}>
          {t(reply.error ?? (reply.busy ? "aiBusy" : "aiSuccess"))}
          {reply.status === "success" && reply.result && (
            <span className="sr-only" lang={reply.result.language}>
              {reply.result.text}
            </span>
          )}
        </StatusNotice>
      )}
    </div>
  );
}
