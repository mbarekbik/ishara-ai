import { Link } from "react-router";
import { modes } from "./modes";
import { useTranslation } from "../../i18n/useTranslation";
import { Icon } from "../../components/Icon";
import type { CommunicationMode } from "./model";
export function ModeSelector({ current }: { current?: CommunicationMode }) {
  const { t } = useTranslation();
  return (
    <nav
      aria-label={t("mode")}
      className={current ? "mode-tabs" : "mode-cards"}
    >
      {modes.map((mode) => (
        <Link
          key={mode.id}
          to={`/communicate?mode=${mode.id}`}
          aria-current={current === mode.id ? "page" : undefined}
          className={current ? "mode-tab" : "mode-card"}
        >
          <span
            className={`icon-tile ${mode.id === "voice" ? "lavender" : ""}`}
          >
            <Icon name={mode.id} size={current ? 20 : 30} />
          </span>
          {current ? (
            <span>{t(mode.label)}</span>
          ) : (
            <>
              <h2>{t(mode.label)}</h2>
              <p>{t(mode.description)}</p>
              <span className="mode-note">
                <Icon name="check" size={16} />
                {t(mode.note)}
              </span>
              <span className="mode-card-action">
                {t(mode.action)}
                <Icon name="arrow" size={20} />
              </span>
            </>
          )}
        </Link>
      ))}
    </nav>
  );
}
