import type { Message, Participant } from "./model";
import { useTranslation } from "../../i18n/useTranslation";
import { Icon } from "../../components/Icon";
export function MessageItem({
  message,
  participants,
}: {
  message: Message;
  participants: Participant[];
}) {
  const { t, locale } = useTranslation();
  const participant = participants.find(
    (item) => item.id === message.sender.id,
  );
  return (
    <li className={`message message-${message.inputType}`}>
      <div className="message-meta">
        <span className="message-avatar">
          <Icon
            name={
              message.inputType === "sign"
                ? "sign"
                : message.inputType === "voice"
                  ? "voice"
                  : "spark"
            }
            size={16}
          />
        </span>
        <strong>
          {message.sender.kind === "assistant"
            ? t("assistant")
            : participant
              ? t(participant.labelKey)
              : message.sender.id}
        </strong>
        <time dateTime={message.createdAt}>
          {new Intl.DateTimeFormat(locale, {
            hour: "2-digit",
            minute: "2-digit",
          }).format(new Date(message.createdAt))}
        </time>
      </div>
      <p dir="auto" lang={message.language}>
        {message.text}
      </p>
      <div className="message-tags">
        <span>{t(message.inputType)}</span>
        {message.source === "mock" && <span>{t("mock")}</span>}
        {message.source === "service" && message.inputType === "voice" && <span>{t("transcribed")}</span>}
      </div>
    </li>
  );
}
