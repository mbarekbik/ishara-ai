import { useTranslation } from "../i18n/useTranslation";
import { ModeSelector } from "../features/communication/ModeSelector";
import { Icon } from "../components/Icon";
export function StartPage() {
  const { t } = useTranslation();
  return (
    <div className="start-page">
      <div className="center-heading">
        <p className="eyebrow">{t("startEyebrow")}</p>
        <h1 tabIndex={-1}>{t("chooseTitle")}</h1>
        <p>{t("chooseBody")}</p>
      </div>
      <ModeSelector />
      <p className="center-note">
        <Icon name="shield" size={18} />
        {t("sessionPrivacy")}
      </p>
      <div className="prototype-note">
        <Icon name="spark" size={18} />
        <p>{t("demoDisclosure")}</p>
      </div>
    </div>
  );
}
