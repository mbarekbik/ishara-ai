import type { CommunicationSession } from "./model";
import type { AIService } from "../ai/service";
import { DemoReplyButton } from "../ai/DemoReplyButton";
import { MessageItem } from "./MessageItem";
import { useTranslation } from "../../i18n/useTranslation";
import { Icon } from "../../components/Icon";
export function ConversationHistory({
  session,
  ai,
}: {
  session: CommunicationSession;
  ai: AIService;
}) {
  const { t, locale } = useTranslation();
  return (
    <aside className="history-panel" aria-labelledby="history-heading">
      <div className="history-header">
        <div>
          <h2 id="history-heading">{t("history")}</h2>
          <p className="small muted">{t("historyNote")}</p>
        </div>
        <span
          className="count"
          aria-label={`${t("messageCount")}: ${session.messages.length}`}
        >
          {new Intl.NumberFormat(locale).format(session.messages.length)}
        </span>
      </div>
      {session.messages.length ? (
        <ol className="messages">
          {session.messages.map((message) => (
            <MessageItem
              key={message.id}
              message={message}
              participants={session.participants}
            />
          ))}
        </ol>
      ) : (
        <div className="empty-history">
          <span className="empty-chat">
            <Icon name="chat" size={32} />
          </span>
          <h3>{t("emptyHistory")}</h3>
          <p>{t("emptyHistoryBody")}</p>
        </div>
      )}
      <DemoReplyButton
        service={ai}
        sessionId={session.id}
        enabled={session.messages.some(
          (message) => message.sender.kind === "human",
        )}
      />
    </aside>
  );
}
