import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, test, vi } from "vitest";
import { AIReplyPanel } from "./AIReplyPanel";
import { AIError, AI_LIMITS, type AIService } from "./service";
import { createMockAIService } from "./mockAIService";
import { LocaleProvider } from "../../i18n/LocaleProvider";
import { LanguageSwitcher } from "../../components/LanguageSwitcher";
import { useSessionStore } from "../communication/sessionStore";
import type { RecognitionResult } from "../communication/interaction";

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  useSessionStore.getState().reset();
});

function addHuman(text = "I cannot attend before 3 p.m.") {
  const session = useSessionStore.getState().session!;
  useSessionStore.getState().append(session.id, {
    id: `human-${session.messages.length}`, sender: { id: "participant-1", kind: "human" },
    inputType: "voice", source: "service", text, language: "en", createdAt: new Date().toISOString(),
  });
}
function mount({ enabled = true, reply = vi.fn<AIService["reply"]>(async () => ({
  text: "Would you like help asking for an appointment after 3 p.m.?", language: "en", source: "service",
})) } = {}) {
  const getConfig = vi.fn<NonNullable<AIService["getConfig"]>>(async () => ({
    enabled, responseLanguages: ["auto", "en", "ar"], limits: AI_LIMITS,
  }));
  const demo = createMockAIService({ delayMs: 5 });
  const demoReply = vi.spyOn(demo, "reply");
  const realService: AIService = { kind: "service", reply, getConfig };
  render(<LocaleProvider><LanguageSwitcher /><AIReplyPanel service={demo} realService={realService} sessionId={useSessionStore.getState().session!.id} /></LocaleProvider>);
  return { reply, getConfig, demoReply, user: userEvent.setup({ advanceTimers: vi.advanceTimersByTimeAsync }) };
}

test("unavailable Real AI requires explicit Demo selection and never calls real generation", async () => {
  addHuman();
  const { user, reply, demoReply } = mount({ enabled: false });
  await screen.findByText(/Real AI is unavailable/);
  expect(screen.getByLabelText("Real AI")).toBeChecked();
  expect(screen.getByRole("button", { name: "Ask Ishara AI" })).toBeDisabled();
  await user.click(screen.getByLabelText("Simulated Demo"));
  await user.click(screen.getByRole("button", { name: "Ask Ishara AI" }));
  await screen.findByText("Simulated assistant reply added");
  expect(reply).not.toHaveBeenCalled();
  expect(demoReply).toHaveBeenCalledTimes(1);
  expect(useSessionStore.getState().session!.messages.at(-1)?.source).toBe("mock");
  expect(screen.getByRole("button", { name: "Ask Ishara AI" })).toBeDisabled();
});

test("Real AI sends the selected response language while an interface change preserves the pending request", async () => {
  addHuman();
  let complete!: (result: RecognitionResult) => void;
  const reply = vi.fn<AIService["reply"]>(() => new Promise((resolve) => { complete = resolve; }));
  const { user } = mount({ reply });
  await waitFor(() => expect(screen.getByRole("button", { name: "Ask Ishara AI" })).toBeEnabled());
  expect(screen.getByText(/up to 12 recent messages to our server and Google/)).toBeVisible();
  await user.selectOptions(screen.getByLabelText("Response language"), "ar");
  await user.click(screen.getByRole("button", { name: "Ask Ishara AI" }));
  expect(screen.getByLabelText("Response language")).toBeDisabled();
  expect(screen.getByLabelText("Simulated Demo")).toBeDisabled();
  expect(reply.mock.calls[0][0].responseLanguage).toBe("ar");
  await user.click(screen.getByRole("button", { name: "العربية" }));
  expect(document.documentElement).toHaveAttribute("dir", "rtl");
  await act(async () => complete({ text: "هل تريد المساعدة في طلب موعد بعد الثالثة؟", language: "ar", source: "service" }));
  expect(useSessionStore.getState().session!.messages).toHaveLength(2);
  expect(useSessionStore.getState().session!.messages.at(-1)).toMatchObject({ language: "ar", source: "service", sender: { kind: "assistant" } });
  expect(screen.getByRole("status")).toHaveTextContent("أُضيف رد إشارة AI إلى محادثتك");
  expect(screen.getByRole("button", { name: "اسأل إشارة AI" })).toBeDisabled();
});

test("Real failure displays a localized recoverable error without a Demo reply", async () => {
  addHuman();
  const reply = vi.fn<AIService["reply"]>(async () => { throw new AIError("AI_LANGUAGE_REQUIRED"); });
  const { user, demoReply } = mount({ reply });
  await waitFor(() => expect(screen.getByRole("button", { name: "Ask Ishara AI" })).toBeEnabled());
  await user.click(screen.getByRole("button", { name: "Ask Ishara AI" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Select English or Arabic and ask again");
  expect(screen.getByLabelText("Real AI")).toBeChecked();
  expect(screen.getByRole("button", { name: "Ask Ishara AI" })).toBeEnabled();
  expect(demoReply).not.toHaveBeenCalled();
  expect(useSessionStore.getState().session!.messages).toHaveLength(1);
});

test("the context notice exposes omitted messages before sharing", async () => {
  for (let index = 0; index < 13; index++) addHuman(`Sentence ${index}.`);
  mount();
  expect(screen.getByText(/Recent messages to share: 12\. Older or ineligible messages omitted: 1\./)).toBeVisible();
});

test("an empty conversation gives a quiet hint; cancelling aborts and enables another Ask", async () => {
  const reply = vi.fn<AIService["reply"]>(() => new Promise(() => {}));
  const { user } = mount({ reply });
  expect(screen.getByText("Complete a new human turn before asking for a reply.")).toBeVisible();
  expect(screen.queryByRole("alert")).toBeNull();
  await act(async () => addHuman());
  await waitFor(() => expect(screen.getByRole("button", { name: "Ask Ishara AI" })).toBeEnabled());
  await user.click(screen.getByRole("button", { name: "Ask Ishara AI" }));
  const signal = reply.mock.calls[0][0].signal;
  await user.click(screen.getByRole("button", { name: "Cancel" }));
  expect(signal.aborted).toBe(true);
  expect(screen.getByRole("button", { name: "Ask Ishara AI" })).toBeEnabled();
  expect(useSessionStore.getState().session!.messages).toHaveLength(1);
});
