import { createContext } from "react";
import type { Locale, TranslationKey } from "./types";
export const LocaleContext = createContext<{
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: (key: TranslationKey) => string;
} | null>(null);
