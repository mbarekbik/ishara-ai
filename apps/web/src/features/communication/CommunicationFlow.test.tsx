import { beforeEach, expect, test, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router";
import { LocaleProvider } from "../../i18n/LocaleProvider";
import { LanguageSwitcher } from "../../components/LanguageSwitcher";
import { CommunicationPage } from "../../pages/CommunicationPage";
import { StartPage } from "../../pages/StartPage";
import { useSessionStore } from "./sessionStore";
import { createMockSignService } from "../sign/mockSignService";
import { createMockSpeechService } from "../voice/mockSpeechService";
import { createMockAIService } from "../ai/mockAIService";
import type { Services } from "../../app/services";
import type { RecognitionResult } from "./interaction";
beforeEach(() => useSessionStore.setState({ session: null }));
function setup(mode = "sign", services?: Services) {
  const defaults = {
    sign: createMockSignService({ delayMs: 5 }),
    speech: createMockSpeechService({ delayMs: 5 }),
    ai: createMockAIService({ delayMs: 5 }),
  };
  render(
    <LocaleProvider>
      <MemoryRouter initialEntries={[`/communicate?mode=${mode}`]}>
        <LanguageSwitcher />
        <Routes>
          <Route
            path="/communicate"
            element={<CommunicationPage services={services ?? defaults} />}
          />
          <Route path="/start" element={<StartPage />} />
        </Routes>
      </MemoryRouter>
    </LocaleProvider>,
  );
  return userEvent.setup();
}
test("sign and voice share a session; sender choice is independent; assistant is explicit", async () => {
  const media = vi.fn();
  vi.stubGlobal("navigator", {
    ...navigator,
    mediaDevices: { getUserMedia: media },
  });
  const user = setup();
  await user.click(
    await screen.findByRole("button", { name: "Use camera-free demo" }),
  );
  await user.selectOptions(
    screen.getByLabelText("Speaking as"),
    "participant-2",
  );
  await user.click(screen.getByRole("button", { name: "Start Signing" }));
  expect(screen.getByLabelText("Speaking as")).toBeDisabled();
  await user.click(screen.getByRole("button", { name: "Stop Signing" }));
  await waitFor(() =>
    expect(useSessionStore.getState().session!.messages).toHaveLength(1),
  );
  const sessionId = useSessionStore.getState().session!.id;
  expect(useSessionStore.getState().session!.messages[0]).toMatchObject({
    inputType: "sign",
    sender: { id: "participant-2" },
    text: "I have an appointment today.",
  });
  await user.click(screen.getByRole("link", { name: "Voice / Speech" }));
  await user.click(screen.getByRole("button", { name: "Start Speaking" }));
  expect(
    screen.getAllByText("Listening · simulation only").length,
  ).toBeGreaterThan(0);
  await user.click(screen.getByRole("button", { name: "Stop Speaking" }));
  await waitFor(() =>
    expect(useSessionStore.getState().session!.messages).toHaveLength(2),
  );
  expect(useSessionStore.getState().session!.id).toBe(sessionId);
  expect(useSessionStore.getState().session!.messages[1].text).toBe(
    "Where do you feel pain?",
  );
  await user.click(
    screen.getByRole("button", { name: "Show demo assistant reply" }),
  );
  await waitFor(() =>
    expect(useSessionStore.getState().session!.messages).toHaveLength(3),
  );
  expect(useSessionStore.getState().session!.messages[2].sender.kind).toBe(
    "assistant",
  );
  expect(media).not.toHaveBeenCalled();
  expect(localStorage.length).toBe(0);
});
test("Arabic switches document direction and keeps the original message language", async () => {
  const user = setup("voice");
  await user.click(
    await screen.findByRole("button", { name: "Start Speaking" }),
  );
  await user.click(screen.getByRole("button", { name: "Stop Speaking" }));
  await waitFor(() =>
    expect(useSessionStore.getState().session!.messages).toHaveLength(1),
  );
  await user.click(screen.getByRole("button", { name: "العربية" }));
  expect(document.documentElement).toHaveAttribute("dir", "rtl");
  expect(document.documentElement).toHaveAttribute("lang", "ar");
  await user.click(screen.getByRole("button", { name: "ابدأ التحدث" }));
  await user.click(screen.getByRole("button", { name: "أنهِ التحدث" }));
  await waitFor(() =>
    expect(useSessionStore.getState().session!.messages).toHaveLength(2),
  );
  const messages = useSessionStore.getState().session!.messages;
  expect(messages[0]).toMatchObject({
    language: "en",
    text: "Where do you feel pain?",
  });
  expect(messages[1].language).toBe("ar");
  expect(
    within(screen.getByRole("list")).getByText("Where do you feel pain?"),
  ).toHaveAttribute("lang", "en");
  expect(localStorage.length).toBe(1);
  expect(localStorage.getItem("ishara.locale.v1")).toBe("ar");
});
test("reset confirms and clears messages; invalid modes redirect to selection", async () => {
  const user = setup("voice");
  await user.click(
    await screen.findByRole("button", { name: "Start Speaking" }),
  );
  await user.click(screen.getByRole("button", { name: "Stop Speaking" }));
  await waitFor(() =>
    expect(useSessionStore.getState().session!.messages).toHaveLength(1),
  );
  const old = useSessionStore.getState().session!.id;
  await user.click(screen.getByRole("button", { name: "New conversation" }));
  expect(
    screen.getByRole("button", { name: "Clear & start again" }),
  ).toHaveFocus();
  await user.click(screen.getByRole("button", { name: "Keep conversation" }));
  expect(
    screen.getByRole("button", { name: "New conversation" }),
  ).toHaveFocus();
  await user.click(screen.getByRole("button", { name: "New conversation" }));
  await user.click(screen.getByRole("button", { name: "Clear & start again" }));
  expect(useSessionStore.getState().session!.id).not.toBe(old);
  expect(useSessionStore.getState().session!.messages).toHaveLength(0);
});
test("invalid mode renders the mode selection", async () => {
  setup("invalid");
  expect(
    await screen.findByRole("heading", {
      name: "How would you like to communicate?",
    }),
  ).toBeVisible();
  expect(useSessionStore.getState().session).toBeNull();
});
test("a provider that ignores abort cannot append after mode switch", async () => {
  let resolve!: (result: RecognitionResult) => void;
  const cancel = vi.fn();
  const user = setup("voice", {
    sign: createMockSignService(),
    ai: createMockAIService(),
    speech: {
      begin: async () => ({
        cancel,
        finish: () =>
          new Promise((done) => {
            resolve = done;
          }),
      }),
    },
  });
  await user.click(
    await screen.findByRole("button", { name: "Start Speaking" }),
  );
  await user.click(screen.getByRole("button", { name: "Stop Speaking" }));
  await user.click(screen.getByRole("link", { name: "Sign Language" }));
  resolve({ text: "Late transcript", language: "en", source: "mock" });
  await waitFor(() => expect(cancel).toHaveBeenCalled());
  expect(useSessionStore.getState().session!.messages).toHaveLength(0);
});
test.each([
  {
    fail: true,
    message: "We couldn’t complete this demo turn. Please try again.",
  },
  { empty: true, message: "No text was returned. Please try another turn." },
])(
  "recovers from mock failure/empty result",
  async ({ message, ...option }) => {
    const user = setup("voice", {
      sign: createMockSignService(),
      ai: createMockAIService(),
      speech: createMockSpeechService({ ...option, delayMs: 1 }),
    });
    await user.click(
      await screen.findByRole("button", { name: "Start Speaking" }),
    );
    await user.click(screen.getByRole("button", { name: "Stop Speaking" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(message);
    expect(useSessionStore.getState().session!.messages).toHaveLength(0);
    expect(
      screen.getByRole("button", { name: "Start Speaking" }),
    ).toBeEnabled();
  },
);
test("denied camera access leaves a fully usable demo fallback", async () => {
  vi.stubGlobal("isSecureContext", true);
  vi.stubGlobal("navigator", {
    ...navigator,
    mediaDevices: {
      getUserMedia: vi
        .fn()
        .mockRejectedValue(new DOMException("", "NotAllowedError")),
    },
  });
  const user = setup();
  await user.click(
    await screen.findByRole("button", { name: "Enable camera" }),
  );
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Camera access was denied",
  );
  expect(screen.getByRole("button", { name: "Retry camera" })).toBeEnabled();
  await user.click(
    screen.getByRole("button", { name: "Use camera-free demo" }),
  );
  await user.click(screen.getByRole("button", { name: "Start Signing" }));
  await user.click(screen.getByRole("button", { name: "Stop Signing" }));
  await waitFor(() =>
    expect(useSessionStore.getState().session!.messages).toHaveLength(1),
  );
});
