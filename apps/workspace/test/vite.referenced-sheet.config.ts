import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import workspace from "../vite.config";

export default defineConfig({
  root: fileURLToPath(new URL("../", import.meta.url)),
  resolve: { ...workspace.resolve },
  plugins: [react(), {
    name: "capture-editor-definition",
    enforce: "pre",
    resolveId(id) {
      if (id === "../../collaboration-editor") return "\0editor-definition";
    },
    load(id) {
      if (id === "\0editor-definition") return "export const createCollaborationEditor = definition => definition;";
    },
  }],
  server: { host: "127.0.0.1", port: 5184, strictPort: true },
});
