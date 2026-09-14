/** Serve the fixed Desktop client roster assembled by DSH at package time. */
import type { Context } from "@deepseek-ai/cordis";
import { bootInjections } from "@deepseek-ai/dsh-client-modules";
import "@deepseek-ai/dsh-host-webserver";
import z from "@deepseek-ai/schemastery";
import { readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { DesktopClientArtifact } from "./desktop-client-artifact.ts";

export interface Config {
  directory: string;
}
export const Config: z<Config> = z.object({ directory: z.string().required() });
export const inject = ["webServer"];
export function apply(ctx: Context, config: Config): void {
  const artifact = JSON.parse(
    readFileSync(join(config.directory, "manifest.json"), "utf8"),
  ) as DesktopClientArtifact;
  if (
    artifact.format !== 1 ||
    !artifact.graph?.entries ||
    !artifact.graph.batches ||
    !artifact.files
  )
    throw new Error("Invalid Desktop client artifact; reinstall Workspace Agent");
  for (const row of [...artifact.graph.entries, ...artifact.graph.batches]) {
    const file = artifact.files[row.url];
    if (
      !file ||
      !/^[a-f0-9]{64}\.js$/.test(file) ||
      row.url !== `/plugins/workspace-desktop/${file}`
    )
      throw new Error("Invalid Desktop client resource");
  }
  ctx.on("webserver/index-inject", (table) => table.push(...bootInjections(artifact.graph)));
  ctx.effect(
    () =>
      ctx.webServer.register({
        kind: "prefix",
        path: "/plugins/workspace-desktop",
        handler: async (req, res) => {
          const url = new URL(req.url ?? "/", "http://desktop.invalid");
          const file = artifact.files[url.pathname];
          if (!file || url.search) {
            res.writeHead(404).end();
            return;
          }
          if (req.method !== "GET" && req.method !== "HEAD") {
            res.writeHead(405, { Allow: "GET, HEAD" }).end();
            return;
          }
          try {
            const bytes = await readFile(join(config.directory, file));
            res.writeHead(200, {
              "content-type": "text/javascript; charset=utf-8",
              "cache-control": "public, max-age=31536000, immutable",
              "content-length": bytes.byteLength,
            });
            res.end(req.method === "HEAD" ? undefined : bytes);
          } catch {
            res.writeHead(500).end();
          }
        },
      }),
    "workspace-desktop: prebuilt browser scripts",
  );
}
