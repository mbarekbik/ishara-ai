import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, test, vi } from "vitest";
import { VoicePanel } from "./VoicePanel";
import { LocaleProvider } from "../../i18n/LocaleProvider";
import { createMockSpeechService } from "./mockSpeechService";
import { useSessionStore } from "../communication/sessionStore";
import type { SpeechService } from "./service";
beforeEach(()=>useSessionStore.getState().reset());
function mount(enabled: boolean) {
  vi.stubGlobal("fetch", vi.fn(async()=>new Response(JSON.stringify({enabled}), {headers:{"Content-Type":"application/json"}})));
  const begin=vi.fn<SpeechService['begin']>(async()=>{throw new Error("MIC_DENIED");});
  render(<LocaleProvider><VoicePanel session={useSessionStore.getState().session!} service={createMockSpeechService({delayMs:1})} realService={{kind:"service",begin}} /></LocaleProvider>);
  return {begin,user:userEvent.setup()};
}
test("unavailable real mode requires explicit Demo selection and no microphone", async () => {
  const {user,begin}=mount(false);
  await screen.findByText(/Real transcription is unavailable/);
  expect(screen.getByRole("button",{name:"Start Speaking"})).toBeDisabled();
  await user.click(screen.getByLabelText("Demo — simulated"));
  await user.click(screen.getByRole("button",{name:"Start Speaking"}));
  await user.click(screen.getByRole("button",{name:"Stop Speaking"}));
  await waitFor(()=>expect(useSessionStore.getState().session!.messages).toHaveLength(1));
  expect(begin).not.toHaveBeenCalled();
});
test("configured real mode starts real service, preserves independent language, and never falls back", async () => {
  const {user,begin}=mount(true);
  await waitFor(()=>expect(screen.getByLabelText("Real transcription")).toBeChecked());
  await user.selectOptions(screen.getByLabelText("Spoken language"), "ar");
  await user.click(screen.getByRole("button",{name:"Start Speaking"}));
  expect(await screen.findByRole("alert")).toHaveTextContent("Microphone access was denied");
  expect(begin.mock.calls[0][0].speechLanguage).toBe("ar");
  expect(screen.getByLabelText("Real transcription")).toBeChecked();
  await act(async()=>Promise.resolve());
  expect(useSessionStore.getState().session!.messages).toHaveLength(0);
});
