import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { dirname, join, resolve, sep } from "node:path";
import { copyFile, mkdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const webRoot = fileURLToPath(new URL("../", import.meta.url));
const publicRoot = join(webRoot, "public");
const manifest = JSON.parse(await readFile(join(webRoot, "vision-assets.json"), "utf8"));
const require = createRequire(import.meta.url);
const packageRoot = dirname(require.resolve("@mediapipe/tasks-vision"));
const packageJson = JSON.parse(await readFile(join(packageRoot, "package.json"), "utf8"));

if (packageJson.version !== manifest.packageVersion) {
  throw new Error("Installed Tasks Vision version does not match vision-assets.json.");
}

function publicPath(relativePath) {
  const absolutePath = resolve(publicRoot, relativePath);
  if (!absolutePath.startsWith(`${publicRoot}${sep}`)) {
    throw new Error("Vision asset path must remain within apps/web/public.");
  }
  return absolutePath;
}

// This script reads only committed assets and the installed package. It never downloads.
const model = await readFile(publicPath(manifest.model.path));
const digest = createHash("sha256").update(model).digest("hex");
if (model.byteLength !== manifest.model.bytes || digest !== manifest.model.sha256) {
  throw new Error("The committed Holistic model failed its size/SHA-256 integrity check.");
}

const wasmDestination = publicPath(manifest.wasmPath);
await mkdir(wasmDestination, { recursive: true });
for (const file of ["vision_wasm_module_internal.js", "vision_wasm_module_internal.wasm"]) {
  await copyFile(join(packageRoot, "wasm", file), join(wasmDestination, file));
}
console.info(`Prepared local Tasks Vision ${manifest.packageVersion} assets; Holistic model integrity verified.`);
