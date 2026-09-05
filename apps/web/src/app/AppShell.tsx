import { Link, Outlet } from "react-router";
import { LanguageSwitcher } from "../components/LanguageSwitcher";
import { Icon } from "../components/Icon";
import { useTranslation } from "../i18n/useTranslation";
import { RouteFocus } from "./RouteFocus";
export function AppShell() {
  const { t } = useTranslation();
  return (
    <>
      <a href="#main" className="skip-link">
        {t("skip")}
      </a>
      <header className="site-header">
        <div className="header-inner">
          <Link
            to="/"
            className="brand"
            aria-label={`${t("brand")} AI — ${t("home")}`}
          >
            <span className="brand-mark" aria-hidden="true">
              <span />
              <span />
              <span />
            </span>
            <span>
              {t("brand")}
              <span className="brand-ai">AI</span>
              <span className="brand-dot">.</span>
            </span>
          </Link>
          <nav className="header-nav" aria-label={t("home")}>
            <Link className="how-link" to="/#how">
              {t("how")}
            </Link>
            <LanguageSwitcher />
          </nav>
        </div>
      </header>
      <RouteFocus />
      <main id="main" tabIndex={-1} className="site-main">
        <Outlet />
      </main>
      <footer className="site-footer">
        <span>
          <Icon name="chat" size={16} />
          {t("footer")}
        </span>
        <span>{t("footerNote")}</span>
      </footer>
    </>
  );
}
