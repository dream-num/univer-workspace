import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import workspaceConfig from "../vite.config";

export default defineConfig({
  root: fileURLToPath(new URL("../", import.meta.url)),
  resolve: workspaceConfig.resolve,
  server: { host: "127.0.0.1", port: 5184, strictPort: true },
});
