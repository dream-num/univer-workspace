import { createRequire } from "node:module";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

const host = process.env.MARKDOWN_HOST === "agent" ? "agent" : "browser";
const require = createRequire(
  new URL(
    host === "agent"
      ? "../dsh-univer-workspace-plugin/package.json"
      : "../../apps/workspace/package.json",
    import.meta.url,
  ),
);
export default defineConfig({
  root: fileURLToPath(new URL("./test/fixtures", import.meta.url)),
  define: { __MARKDOWN_HOST__: JSON.stringify(host) },
  resolve: {
    alias: {
      react: dirname(require.resolve("react/package.json")),
      "react-dom": dirname(require.resolve("react-dom/package.json")),
    },
  },
  server: { host: "127.0.0.1", fs: { allow: [fileURLToPath(new URL("../../", import.meta.url))] } },
});
