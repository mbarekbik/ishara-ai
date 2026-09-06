import { loadEnvFile } from "node:process";
import { fileURLToPath } from "node:url";

/** Load server configuration in both src/ and compiled dist/, regardless of cwd. */
export function loadApiEnvironment(load: typeof loadEnvFile = loadEnvFile): void {
  try {
    // Node preserves variables already supplied by the launching environment.
    load(fileURLToPath(new URL("../.env", import.meta.url)));
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") return;
    // Never attach the original error: it could contain environment-file data.
    throw new Error("Unable to load the API environment file");
  }
}
