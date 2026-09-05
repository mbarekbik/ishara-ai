import { Link } from "react-router";
import { useTranslation } from "../i18n/useTranslation";
export function NotFoundPage() {
  const { t } = useTranslation();
  return (
    <div className="center-heading not-found">
      <p className="eyebrow">404</p>
      <h1 tabIndex={-1}>{t("notFound")}</h1>
      <p>{t("notFoundBody")}</p>
      <Link to="/" className="button button-primary">
        {t("backHome")}
      </Link>
    </div>
  );
}
