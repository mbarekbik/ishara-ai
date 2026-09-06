import { useEffect, useRef, useState } from "react";
import { Navigate, useSearchParams } from "react-router";
import { useTranslation } from "../i18n/useTranslation";
import { useSessionStore } from "../features/communication/sessionStore";
import { isMode } from "../features/communication/modes";
import { ModeSelector } from "../features/communication/ModeSelector";
import { ConversationHistory } from "../features/communication/ConversationHistory";
import { SignPanel } from "../features/sign/SignPanel";
import { VoicePanel } from "../features/voice/VoicePanel";
import { createServices, type Services } from "../app/services";
import { Button } from "../components/Button";
import { Icon } from "../components/Icon";
import type {
  CommunicationMode,
  CommunicationSession,
} from "../features/communication/model";
function SessionView({
  session,
  mode,
  suppliedServices,
}: {
  session: CommunicationSession;
  mode: CommunicationMode;
  suppliedServices?: Services;
}) {
  const { t } = useTranslation();
  const [services] = useState(() => suppliedServices ?? createServices());
  const [confirm, setConfirm] = useState(false);
  const [interactionRevision, setInteractionRevision] = useState(0);
  const resetSession = useSessionStore((state) => state.reset);
  const reset = () => {
    resetSession();
    requestAnimationFrame(() =>
      document.querySelector<HTMLElement>("h1")?.focus(),
    );
  };
  const clearButton = useRef<HTMLButtonElement>(null);
  const newButton = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (confirm) clearButton.current?.focus();
  }, [confirm]);
  return (
    <>
      <div className="session-heading">
        <div>
          <p className="eyebrow">{t("sessionEyebrow")}</p>
          <h1 tabIndex={-1}>{t("sessionTitle")}</h1>
          <p className="muted">{t("sessionBody")}</p>
        </div>
        <Button
          ref={newButton}
          variant="secondary"
          onClick={() => {
            setInteractionRevision((revision) => revision + 1);
            if (session.messages.length) setConfirm(true); else reset();
          }}
        >
          {t("newConversation")}
        </Button>
      </div>
      {confirm && (
        <div
          className="reset-confirm"
          role="group"
          aria-label={t("newConversation")}
        >
          <p>{t("resetQuestion")}</p>
          <Button ref={clearButton} variant="danger" onClick={reset}>
            {t("clear")}
          </Button>
          <Button
            variant="secondary"
            onClick={() => {
              setConfirm(false);
              newButton.current?.focus();
            }}
          >
            {t("keep")}
          </Button>
        </div>
      )}
      <div className="session-toolbar">
        <ModeSelector current={mode} />
        <span className="small muted inline-note">
          <Icon name="shield" size={15} />
          {t("sessionPrivacy")}
        </span>
      </div>
      <div className="communication-grid" key={`${mode}:${interactionRevision}`}>
        {mode === "sign" ? (
          <SignPanel session={session} service={services.sign} />
        ) : (
          <VoicePanel session={session} service={services.speech} realService={services.realSpeech} />
        )}
        <ConversationHistory session={session} ai={services.ai} realAI={services.realAI} />
      </div>
      <div className="prototype-note session-disclosure">
        <Icon name="spark" size={18} />
        <p>{t("demoDisclosure")}</p>
      </div>
    </>
  );
}
export function CommunicationPage({ services }: { services?: Services }) {
  const [params] = useSearchParams();
  const mode = params.get("mode");
  const session = useSessionStore((state) => state.session);
  const ensureSession = useSessionStore((state) => state.ensureSession);
  useEffect(() => {
    if (isMode(mode)) ensureSession();
  }, [mode, ensureSession]);
  if (!isMode(mode)) return <Navigate to="/start" replace />;
  if (!session) return null;
  return (
    <SessionView
      key={session.id}
      session={session}
      mode={mode}
      suppliedServices={services}
    />
  );
}
