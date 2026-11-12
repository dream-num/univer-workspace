import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";
import workspaceConfig from "../../vite.config.ts";

export default defineConfig({
  root: fileURLToPath(new URL("../../", import.meta.url)),
  resolve: workspaceConfig.resolve,
  plugins: [react(), tailwindcss()],
  server: { host: "127.0.0.1", port: 5187, strictPort: true },
});
