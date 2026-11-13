import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { isHtmlViewFilename } from "@univerjs-labs/html-view";
import express, { type Router } from "express";
import { ANONYMOUS_USER_ID } from "../modules/identity/index.js";
import type { NodesModule, NodeSummary } from "../modules/nodes/index.js";
import { notFoundHandler } from "./errors.js";

export function createStaticSiteRouter(publicDirectory: string, options?: {
  readonly nodes: Pick<NodesModule, "get">;
  readonly publicOrigin?: string | null | undefined;
}): Router {
  const router = express.Router();

  // Vite emits content-hashed filenames under assets/, so a URL there never
  // changes content. A missing hash is a stale client asking for a previous
  // deploy's chunk; it gets a 404 instead of the SPA's index.html.
  router.use(
    "/assets",
    express.static(resolve(publicDirectory, "assets"), {
      maxAge: "1y",
      immutable: true,
    }),
    notFoundHandler
  );
  router.use(express.static(publicDirectory));
  router.get("/nodes/:nodeId", async (request, response, next) => {
    if (!options) return next();
    let node: NodeSummary;
    try {
      node = options.nodes.get(ANONYMOUS_USER_ID, request.params.nodeId).node;
    } catch {
      // Metadata must never disclose a failed or unauthorized lookup.
      return next();
    }
    const htmlView = node.resource?.kind === "blob" && isHtmlViewFilename(node.name);
    const name = htmlView ? node.name.slice(0, -".univer.html".length) : node.name;
    const title = escapeHtml(`${name} · Univer Workspace`);
    const chinese = request.acceptsLanguages("en", "zh") === "zh";
    const description = htmlView
      ? (chinese ? "使用 Univer Workspace 制作的实时数据页面" : "A live data page made with Univer Workspace")
      : (chinese ? "分享自 Univer Workspace" : "Shared from Univer Workspace");
    const metadata = [
      `<meta property="og:title" content="${title}" />`,
      `<meta property="og:description" content="${escapeHtml(description)}" />`,
      '<meta property="og:type" content="website" />',
      '<meta property="og:site_name" content="Univer Workspace" />',
      '<meta name="twitter:card" content="summary" />',
    ];
    if (options.publicOrigin) {
      const url = new URL(`/nodes/${encodeURIComponent(node.id)}`, options.publicOrigin);
      url.search = new URL(request.originalUrl, options.publicOrigin).search;
      metadata.push(`<meta property="og:url" content="${escapeHtml(url.href)}" />`);
    }
    const html = await readFile(resolve(publicDirectory, "index.html"), "utf8");
    const head = html.replace(/<title>.*?<\/title>/isu, () => `<title>${title}</title>`)
      .replace(/<\/head>/iu, () => `${metadata.join("\n")}\n</head>`);
    response.vary("Accept-Language");
    response.setHeader("Cache-Control", "public, max-age=0");
    response.type("html").send(head);
  });
  router.get("/{*path}", (_request, response) => {
    response.sendFile(resolve(publicDirectory, "index.html"));
  });

  return router;
}

function escapeHtml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");
}
