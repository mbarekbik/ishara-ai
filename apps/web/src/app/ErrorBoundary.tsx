import { Component, type ReactNode } from "react";
import { LocaleContext } from "../i18n/context";
import { en } from "../i18n/en";
export class ErrorBoundary extends Component<
  { children: ReactNode },
  { failed: boolean }
> {
  static contextType = LocaleContext;
  declare context: React.ContextType<typeof LocaleContext>;
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    if (!this.state.failed) return this.props.children;
    const t = this.context?.t ?? ((key: keyof typeof en) => en[key]);
    return (
      <main className="center-heading" role="alert">
        <h1>{t("unexpectedTitle")}</h1>
        <p>{t("unexpectedBody")}</p>
        <button
          className="button button-primary"
          onClick={() => window.location.reload()}
        >
          {t("reload")}
        </button>
      </main>
    );
  }
}
