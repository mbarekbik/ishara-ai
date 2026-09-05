import { create } from "zustand";
import { createId } from "./createId";
import type { CommunicationSession, Message } from "./model";
const newSession = (): CommunicationSession => ({
  id: createId(),
  startedAt: new Date().toISOString(),
  participants: [
    { id: "participant-1", labelKey: "participant1" },
    { id: "participant-2", labelKey: "participant2" },
  ],
  messages: [],
});
interface SessionState {
  session: CommunicationSession | null;
  ensureSession: () => void;
  reset: () => void;
  append: (sessionId: string, message: Message) => boolean;
}
export const useSessionStore = create<SessionState>((set, get) => ({
  session: null,
  ensureSession: () => {
    if (!get().session) set({ session: newSession() });
  },
  reset: () => set({ session: newSession() }),
  append: (sessionId, message) => {
    const session = get().session;
    if (
      !session ||
      session.id !== sessionId ||
      !message.text.trim() ||
      session.messages.some((item) => item.id === message.id)
    )
      return false;
    set({
      session: {
        ...session,
        messages: [
          ...session.messages,
          { ...message, text: message.text.trim() },
        ],
      },
    });
    return true;
  },
}));
