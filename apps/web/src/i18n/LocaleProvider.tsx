import { useEffect, useState, type ReactNode } from "react";
import { en } from "./en";
import { ar } from "./ar";
import { LocaleContext } from "./context";
import type { Locale, TranslationKey } from "./types";
const key = "ishara.locale.v1";
const dictionaries = { en, ar };
export function LocaleProvider({ children }: { children: ReactNode }) {
  const [locale, update] = useState<Locale>(() => {
    try {
      return localStorage.getItem(key) === "ar" ? "ar" : "en";
    } catch {
      return "en";
    }
  });
  useEffect(() => {
    document.documentElement.lang = locale;
    document.documentElement.dir = locale === "ar" ? "rtl" : "ltr";
  }, [locale]);
  const setLocale = (next: Locale) => {
    update(next);
    try {
      localStorage.setItem(key, next);
    } catch {
      /* Locale can remain memory-only. */
    }
  };
  const t = (translationKey: TranslationKey) =>
    dictionaries[locale][translationKey];
  return (
    <LocaleContext value={{ locale, setLocale, t }}>{children}</LocaleContext>
  );
}
