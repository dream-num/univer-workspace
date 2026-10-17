import { createHash } from "node:crypto";
import { Router } from "express";
import { isHtmlViewFilename, parseHtmlView } from "@univerjs-labs/html-view";
import type { AccessResolver } from "../access/index.js";
import type { BlobsModule } from "../blobs/index.js";
import { ANONYMOUS_USER_ID, type IdentityModule } from "../identity/index.js";
import { ApplicationError } from "../../middleware/errors.js";

// A top-level uploaded document must never inherit the Workspace session origin.
export const standaloneAppPolicy = [
  "sandbox allow-scripts allow-popups allow-popups-to-escape-sandbox allow-downloads allow-top-navigation-by-user-activation",
  "default-src 'none'",
  "script-src 'unsafe-inline' https://cdn.jsdelivr.net",
  "style-src 'unsafe-inline' https://cdn.jsdelivr.net",
  "img-src https://cdn.jsdelivr.net data: blob:",
  "font-src https://cdn.jsdelivr.net data:",
  "connect-src 'none'",
  "frame-src 'none'",
  "worker-src 'none'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
].join("; ");
const maxStandaloneBytes = 5 * 1024 * 1024;
// The fragment never reaches the server; capture it before entering login.
const loginScript = "location.replace('/login?returnTo='+encodeURIComponent(location.pathname+location.search+location.hash))";
const loginScriptHash = createHash("sha256").update(loginScript).digest("base64");

export function createStandaloneAppRouter(options: {
  readonly identity: IdentityModule;
  readonly access: AccessResolver;
  readonly blobs: BlobsModule;
}): Router {
  const router = Router();
  router.get("/apps/:nodeId/run", async (request, response) => {
    response.setHeader("Cache-Control", "private, no-store");
    response.setHeader("X-Content-Type-Options", "nosniff");
    response.setHeader("Referrer-Policy", "no-referrer");
    const session = options.identity.getSession(request.headers.cookie);
    const userId = session.authenticated ? session.user.id : ANONYMOUS_USER_ID;
    const node = options.access.resolveNode(userId, request.params.nodeId);
    if (!node && !session.authenticated) {
      response.setHeader("Content-Security-Policy", `default-src 'none'; script-src 'sha256-${loginScriptHash}'; base-uri 'none'; frame-ancestors 'none'`);
      response.type("html").send(`<!doctype html><title>Sign in to Workspace</title><script>${loginScript}</script><noscript>Please sign in to Workspace, then reopen this App.</noscript>`);
      return;
    }
    if (!node || node.resourceKind !== "blob" || !node.resourceId) {
      throw new ApplicationError("NOT_FOUND", 404, "The App was not found.");
    }
    const access = options.access.resolveResource(userId, node.resourceId);
    if (!access || access.kind !== "blob" || !isHtmlViewFilename(access.originalFilename)) {
      throw new ApplicationError("NOT_FOUND", 404, "The App was not found.");
    }
    const opened = await options.blobs.openContent(userId, node.resourceId, undefined);
    if (opened.totalByteSize > maxStandaloneBytes) {
      opened.stream.destroy();
      throw new ApplicationError("PAYLOAD_TOO_LARGE", 413, "Standalone HTML Apps must be 5 MiB or smaller.");
    }
    const chunks: Buffer[] = [];
    for await (const chunk of opened.stream) chunks.push(Buffer.from(chunk));
    const html = Buffer.concat(chunks).toString("utf8");
    response.setHeader("Content-Security-Policy", standaloneAppPolicy);
    let hasBindings: boolean;
    try {
      hasBindings = parseHtmlView(html).bindings.length > 0;
    } catch {
      throw new ApplicationError("INVALID_INPUT", 400, "The App contains invalid HTML binding declarations.");
    }
    if (hasBindings) {
      response.status(400).type("html").send(`<!doctype html><title>Open in Workspace</title><p>This App uses live Sheet bindings. Open it in Workspace to connect its data.</p><a href="/nodes/${encodeURIComponent(node.id)}?view=immersive">Open in Workspace</a>`);
      return;
    }
    response.type("html").send(html);
  });
  return router;
}
