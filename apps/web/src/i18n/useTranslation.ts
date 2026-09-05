import { useContext } from "react";
import { LocaleContext } from "./context";
export function useTranslation() {
  const value = useContext(LocaleContext);
  if (!value) throw new Error("LocaleProvider is required");
  return value;
}
