import type { en } from "./en";
export type Locale = "en" | "ar";
export type TranslationKey = keyof typeof en;
export type Dictionary = Record<TranslationKey, string>;
