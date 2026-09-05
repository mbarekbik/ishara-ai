import { expect, test } from "vitest";
import { en } from "./en";
import { ar } from "./ar";
test("Arabic covers every English translation with nonempty text", () => {
  expect(Object.keys(ar).sort()).toEqual(Object.keys(en).sort());
  expect(Object.values(ar).every((value) => value.trim().length > 0)).toBe(
    true,
  );
});
