import { createApp } from "./app.js";
import { readConfig } from "./config.js";
import { loadApiEnvironment } from "./loadEnvironment.js";
loadApiEnvironment();
const { port, live } = readConfig();
const app = createApp(live);
const server = app.listen(port, "127.0.0.1", () => {
  console.info(`Ishara API listening on http://127.0.0.1:${port}`);
});
for (const signal of ["SIGINT", "SIGTERM"] as const)
  process.on(signal, () => {
    server.close();
  });
