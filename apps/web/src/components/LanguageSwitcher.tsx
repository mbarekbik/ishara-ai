import { useTranslation } from "../i18n/useTranslation";
export function LanguageSwitcher() {
  const { locale, setLocale, t } = useTranslation();
  return (
    <div className="language-switch" role="group" aria-label={t("language")}>
      <button
        lang="en"
        aria-pressed={locale === "en"}
        onClick={() => setLocale("en")}
      >
        EN
      </button>
      <span aria-hidden="true" />
      <button
        lang="ar"
        aria-pressed={locale === "ar"}
        onClick={() => setLocale("ar")}
      >
        العربية
      </button>
    </div>
  );
}
