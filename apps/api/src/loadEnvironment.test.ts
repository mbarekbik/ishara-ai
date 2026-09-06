import { expect, test, vi } from "vitest";
import { fileURLToPath } from "node:url";
import { loadApiEnvironment } from "./loadEnvironment.js";

test("loads the API-local environment file using a module-relative path", () => {
  const load = vi.fn();
  loadApiEnvironment(load);
  expect(load).toHaveBeenCalledExactlyOnceWith(fileURLToPath(new URL("../.env", import.meta.url)));
});

test("allows an absent file when configuration is supplied by the process", () => {
  expect(() => loadApiEnvironment(() => { throw Object.assign(new Error("missing"), { code: "ENOENT" }); })).not.toThrow();
});

test("does not expose file error details or attach the underlying error", () => {
  let failure: unknown;
  try { loadApiEnvironment(() => { throw new Error("private file data"); }); } catch (error) { failure = error; }
  expect(failure).toEqual(new Error("Unable to load the API environment file"));
  expect(failure).not.toHaveProperty("cause");
});
