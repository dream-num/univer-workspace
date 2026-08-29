import type { IncomingMessage, ServerResponse } from "node:http";
import type { Context } from "@deepseek-ai/cordis";
import type {} from "@deepseek-ai/dsh-host-webserver";
import {
  WORKSPACE_FAVICON_SVG,
  WORKSPACE_MANIFEST_JSON,
  rewriteWorkspaceIndexBranding,
} from "./branding.ts";

export const name = "dsh-univer-workspace-skin-plugin";

export const inject = ["webServer"];

function serveAsset(req: IncomingMessage, res: ServerResponse, contentType: string, body: string): void {
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
  ctx.effect(() => ctx.webServer.tapIndex(rewriteWorkspaceIndexBranding), "univer-workspace-skin: first-paint branding");
  ctx.effect(() => {
    const favicon = ctx.webServer.register({
      kind: "exact",
      path: "/favicon.svg",
      handler: (req, res) => serveAsset(req, res, "image/svg+xml; charset=utf-8", WORKSPACE_FAVICON_SVG),
    });
    const manifest = ctx.webServer.register({
      kind: "exact",
      path: "/manifest.webmanifest",
      handler: (req, res) => serveAsset(req, res, "application/manifest+json; charset=utf-8", WORKSPACE_MANIFEST_JSON),
    });
    return () => {
      manifest();
      favicon();
    };
  }, "univer-workspace-skin: static branding assets");
}
