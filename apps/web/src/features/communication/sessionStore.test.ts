import { beforeEach, expect, test } from "vitest";
import { useSessionStore } from "./sessionStore";
import type { Message } from "./model";
beforeEach(() => useSessionStore.setState({ session: null }));
const message = (id: string): Message => ({
  id,
  sender: { id: "participant-2", kind: "human" },
  inputType: "sign",
  text: "Hello",
  language: "en",
  createdAt: new Date().toISOString(),
  source: "mock",
});
test("creates once, preserves insertion order and independently models sender and mode", () => {
  const store = useSessionStore.getState();
  store.ensureSession();
  const id = useSessionStore.getState().session!.id;
  store.ensureSession();
  expect(useSessionStore.getState().session!.id).toBe(id);
  expect(store.append(id, message("b"))).toBe(true);
  expect(store.append(id, message("a"))).toBe(true);
  expect(
    useSessionStore.getState().session!.messages.map((item) => item.id),
  ).toEqual(["b", "a"]);
  expect(useSessionStore.getState().session!.messages[0].sender.id).toBe(
    "participant-2",
  );
  expect(localStorage.length).toBe(0);
});
test("rejects duplicates, empty results and old-session writes after reset", () => {
  const store = useSessionStore.getState();
  store.ensureSession();
  const id = useSessionStore.getState().session!.id;
  store.append(id, message("a"));
  expect(store.append(id, message("a"))).toBe(false);
  expect(store.append(id, { ...message("empty"), text: "   " })).toBe(false);
  store.reset();
  expect(store.append(id, message("late"))).toBe(false);
  expect(useSessionStore.getState().session!.messages).toEqual([]);
});
