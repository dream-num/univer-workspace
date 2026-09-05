import type { IncomingMessage, ServerResponse } from "node:http";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import type { Context } from "@deepseek-ai/cordis";
import type {} from "@deepseek-ai/dsh-host-webserver";
import {
  WORKSPACE_FAVICON_SVG,
  WORKSPACE_MANIFEST_JSON,
  rewriteWorkspaceIndexBranding,
} from "./branding.ts";

export const name = "dsh-univer-workspace-skin-plugin";

export const inject = ["webServer"];

const CLIENT_CSS_PATH = "/plugins/dsh-univer-workspace-skin-plugin/client.css";
const CLIENT_CSS_URL = `${CLIENT_CSS_PATH}?rev=${clientCssRevision()}`;

function clientCssRevision(): string {
  try {
    return createHash("sha256")
      .update(readFileSync(new URL("./client.css", import.meta.url)))
      .digest("hex")
      .slice(0, 12);
  } catch {
    return "dev";
  }
}

function serveAsset(
  req: IncomingMessage,
  res: ServerResponse,
  contentType: string,
  body: string,
): void {
  if (req.method !== "GET" && req.method !== "HEAD") {
    res.writeHead(405);
    res.end();
    return;
  }
  res.writeHead(200, { "content-type": contentType, "cache-control": "no-cache" });
  if (req.method === "HEAD") res.end();
  else res.end(body);
}

export function apply(ctx: Context): void {
  ctx.effect(
    () => ctx.webServer.tapIndex(rewriteWorkspaceIndexBranding),
    "univer-workspace-skin: first-paint branding",
  );
  ctx.effect(() => {
    const stylesheet = ctx.webServer.register({
      kind: "exact",
      path: CLIENT_CSS_PATH,
      handler: async (req, res) => {
        if (req.method !== "GET" && req.method !== "HEAD") {
          res.writeHead(405);
          res.end();
          return;
        }
        try {
          const css = await readFile(new URL("./client.css", import.meta.url));
          res.writeHead(200, {
            "content-type": "text/css; charset=utf-8",
            "cache-control": "public, max-age=31536000, immutable",
          });
          if (req.method === "HEAD") res.end();
          else res.end(css);
        } catch {
          res.writeHead(404);
          res.end();
        }
      },
    });
    const favicon = ctx.webServer.register({
      kind: "exact",
      path: "/favicon.svg",
      handler: (req, res) =>
        serveAsset(req, res, "image/svg+xml; charset=utf-8", WORKSPACE_FAVICON_SVG),
    });
    const manifest = ctx.webServer.register({
      kind: "exact",
      path: "/manifest.webmanifest",
      handler: (req, res) =>
        serveAsset(req, res, "application/manifest+json; charset=utf-8", WORKSPACE_MANIFEST_JSON),
    });
    return () => {
      stylesheet();
      manifest();
      favicon();
    };
  }, "univer-workspace-skin: static branding assets");
  ctx.on("webserver/index-inject", (table) => {
    table.push({
      kind: "html",
      placement: "head",
      html: `<link rel="stylesheet" href="${CLIENT_CSS_URL}">`,
    });
  });
}
