import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { isHtmlViewFilename } from "@univerjs-labs/html-view";
import express, { type Router } from "express";
import { ANONYMOUS_USER_ID, type IdentityModule } from "../modules/identity/index.js";
import type { NodesModule, NodeSummary } from "../modules/nodes/index.js";
import type { PermissionsModule } from "../modules/permissions/index.js";
import { logger } from "../logging/logger.js";
import { notFoundHandler } from "./errors.js";
import { recordLoopEvent } from "./loop-metrics.js";

export function createStaticSiteRouter(publicDirectory: string, options?: {
  readonly nodes: Pick<NodesModule, "get">;
  readonly identity: Pick<IdentityModule, "recordAgentPageView" | "hasSession">;
  readonly permissions: Pick<PermissionsModule, "nodeOwnerCategory">;
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
      node = (await options.nodes.get(ANONYMOUS_USER_ID, request.params.nodeId)).node;
    } catch {
      // Metadata must never disclose a failed or unauthorized lookup.
      return next();
    }
    // Only a page the anonymous reader got: an expired agent's page stays closed until the agent returns.
    await options.identity.recordAgentPageView(node.id);
    if (request.method === "GET") {
      // Not awaited: counting must neither fail nor delay the page.
      const { identity, permissions } = options;
      void (async () => {
        try {
          const [signedIn, owner] = await Promise.all([
            identity.hasSession(request.headers.cookie),
            permissions.nodeOwnerCategory(node.id),
          ]);
          recordLoopEvent("workspace.share_page", { session: signedIn ? "signed_in" : "signed_out", owner_category: owner }, {
            node_id: node.id,
            user_agent: request.get("user-agent") ?? null,
          });
        } catch (error) {
          logger.warn({ err: error, node_id: node.id }, "Share page view not counted");
        }
      })();
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
    ];
    if (options.publicOrigin) {
      const url = new URL(`/nodes/${encodeURIComponent(node.id)}`, options.publicOrigin);
      url.search = new URL(request.originalUrl, options.publicOrigin).search;
      const kind = previewKind(node, htmlView);
      const image = escapeHtml(new URL(`/link-preview/${kind}.png`, options.publicOrigin).href);
      metadata.push(
        `<meta property="og:url" content="${escapeHtml(url.href)}" />`,
        `<meta property="og:image" content="${image}" />`,
        '<meta property="og:image:width" content="1200" />',
        '<meta property="og:image:height" content="630" />',
        `<meta property="og:image:alt" content="${escapeHtml(`Univer Workspace ${previewAlt[kind][chinese ? 1 : 0]}`)}" />`,
        '<meta name="twitter:card" content="summary_large_image" />',
        `<meta name="twitter:image" content="${image}" />`,
      );
    } else {
      // Open Graph requires an absolute image URL, and the request Host is untrusted.
      metadata.push('<meta name="twitter:card" content="summary" />');
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

type PreviewKind = "sheet" | "doc" | "slide" | "page" | "folder" | "file";

function previewKind(node: NodeSummary, htmlView: boolean): PreviewKind {
  if (htmlView) return "page";
  if (node.resource === null) return "folder";
  const unitType = node.resource.kind === "univer" ? node.resource.unitType : null;
  return unitType === "sheet" || unitType === "doc" || unitType === "slide" ? unitType : "file";
}

const previewAlt: Record<PreviewKind, readonly [english: string, chinese: string]> = {
  sheet: ["spreadsheet", "表格"],
  doc: ["document", "文档"],
  slide: ["slides", "幻灯片"],
  page: ["live data page", "实时数据页面"],
  folder: ["folder", "文件夹"],
  file: ["file", "文件"],
};

function escapeHtml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");
}
