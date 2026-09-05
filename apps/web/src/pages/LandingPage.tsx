import { Link } from "react-router";
import { useTranslation } from "../i18n/useTranslation";
import { Icon } from "../components/Icon";
export function LandingPage() {
  const { t } = useTranslation();
  return (
    <>
      <section className="hero">
        <div className="hero-copy">
          <p className="eyebrow">
            <span className="tiny-line" />
            {t("eyebrow")}
          </p>
          <h1 tabIndex={-1}>
            {t("heroTitle")}
            <br />
            <em>{t("heroAccent")}</em>
          </h1>
          <p className="hero-description">{t("heroDescription")}</p>
          <Link to="/start" className="button button-primary hero-cta">
            {t("start")}
            <Icon name="arrow" size={21} />
          </Link>
          <p className="start-note">
            <Icon name="shield" size={15} />
            {t("noAccount")}
          </p>
        </div>
        <div className="hero-art" aria-label={t("sampleCaption")}>
          <span className="art-orbit" aria-hidden="true" />
          <div className="connection-badge">
            <span className="status-dot" />
            {t("heroNote")}
          </div>
          <div className="demo-conversation">
            <div className="demo-card-header">
              <span className="mini-brand">
                <Icon name="sign" size={18} />
              </span>
              <span>{t("liveSession")}</span>
              <span className="pill">{t("mock")}</span>
            </div>
            <div className="demo-message sign-example">
              <span className="demo-message-label">
                <Icon name="sign" size={16} />
                {t("sign")}
              </span>
              <p>{t("signExample")}</p>
            </div>
            <div className="bridge-dots" aria-hidden="true">
              · · ·
            </div>
            <div className="demo-message voice-example">
              <span className="demo-message-label">
                <Icon name="voice" size={16} />
                {t("voice")}
              </span>
              <p>{t("voiceExample")}</p>
            </div>
            <div className="demo-card-footer">
              <Icon name="shield" size={14} />
              {t("historyNote")}
            </div>
          </div>
          <span className="floating-symbol sign-symbol" aria-hidden="true">
            <Icon name="sign" size={34} />
          </span>
          <span className="floating-symbol voice-symbol" aria-hidden="true">
            <Icon name="voice" size={30} />
          </span>
          <div className="art-caption">
            <span />
            {t("demoLabel")}
          </div>
        </div>
      </section>
      <div className="prototype-note">
        <Icon name="spark" size={18} />
        <p>{t("demoDisclosure")}</p>
      </div>
      <section className="how-section" id="how">
        <div className="section-heading">
          <p className="eyebrow">{t("how")}</p>
          <h2>{t("bridgeTitle")}</h2>
          <p className="muted">{t("bridgeDescription")}</p>
        </div>
        <div className="steps">
          {(["One", "Two", "Three"] as const).map((number, index) => (
            <article key={number}>
              <span className="step-number">0{index + 1}</span>
              <h3>{t(`step${number}`)}</h3>
              <p>{t(`step${number}Body`)}</p>
            </article>
          ))}
        </div>
      </section>
      <section className="privacy-banner">
        <span className="icon-tile">
          <Icon name="shield" size={28} />
        </span>
        <div>
          <h2>{t("privateTitle")}</h2>
          <p>{t("privateBody")}</p>
        </div>
        <Icon name="check" size={24} />
      </section>
    </>
  );
}
