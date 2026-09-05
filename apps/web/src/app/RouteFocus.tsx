import { useEffect } from "react";
import { useLocation } from "react-router";
import { useTranslation } from "../i18n/useTranslation";
export function RouteFocus() {
  const location = useLocation();
  const { t, locale } = useTranslation();
  const route = `${location.pathname}${location.search}${location.hash}`;
  useEffect(() => {
    const title =
      location.pathname === "/"
        ? t("heroTitle") + " " + t("heroAccent")
        : location.pathname === "/start"
          ? t("chooseTitle")
          : location.pathname === "/communicate"
            ? t("sessionTitle")
            : t("notFound");
    document.title = `${title} | Ishara AI`;
  }, [location.pathname, locale, t]);
  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      const heading = document.querySelector<HTMLElement>(
        location.hash === "#how" ? "#how h2" : "h1",
      );
      if (heading) {
        heading.tabIndex = -1;
        heading.focus({ preventScroll: true });
      }
      if (location.hash === "#how")
        document.getElementById("how")?.scrollIntoView();
      else window.scrollTo(0, 0);
    });
    return () => cancelAnimationFrame(frame);
  }, [route, location.hash]);
  return null;
}
