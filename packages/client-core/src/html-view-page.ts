import { isHtmlViewFilename } from "@univerjs-labs/html-view";
import type { WorkspaceSubject } from "./auth.js";
import { WorkspaceBlobFeature } from "./blob.js";
import { workspaceError } from "./errors.js";
import type { AuthenticatedWorkspaceHttp } from "./http.js";

export interface HtmlViewAccessInput {
  readonly repositoryVisibility?: "public" | "private" | undefined;
  readonly privateSourceUnitIds?: readonly string[] | undefined;
  readonly caller?: WorkspaceSubject | undefined;
  readonly handoffUrl?: string | undefined;
  readonly spaceType?: "personal" | "team" | undefined;
}

export function describeHtmlViewAccess(input: HtmlViewAccessInput): string {
  if (input.caller?.kind === "agent" && !input.caller.claimed) {
    return input.handoffUrl
      ? "Only this temporary agent can open shareUrl directly. Give the user handoffUrl instead so they can open the page live without signing in and claim this agent."
      : "Only this temporary agent can open shareUrl directly. Do not give shareUrl to the user alone; run claim (uvw claim in the CLI) with this node to get a handoff link so they can open the page live without signing in.";
  }
  const privateCount = input.privateSourceUnitIds?.length ?? 0;
  if (input.repositoryVisibility === "public" && privateCount === 0) {
    return "Anyone with the link can open shareUrl and view its live data without signing in (read-only for visitors).";
  }
  if (input.repositoryVisibility === "public" && privateCount > 0) {
    return `Anyone with the link can open shareUrl, but its private source Sheets (${input.privateSourceUnitIds!.join(", ")}) require signing in with access.`;
  }
  if (input.repositoryVisibility === "private") {
    return input.spaceType === "personal"
      ? "Only signed-in people with access can open shareUrl. To let anyone with the link view it without signing in, ask the user before turning on Link Sharing."
      : "Only signed-in people with access can open shareUrl. To let anyone with the link view it without signing in, ask the user before making the repository public.";
  }
  return "Only signed-in people with access can open shareUrl unless the repository is public or Link Sharing is enabled.";
}

export interface WorkspaceHtmlViewPage {
  readonly resourceId: string;
  readonly nodeId: string;
  readonly spaceId: string;
  readonly name: string;
  readonly html: string;
  readonly etag: string;
}

export function requireHtmlView(name: string): void {
  if (!isHtmlViewFilename(name)) {
    throw workspaceError("workspace-resource-kind-mismatch", "Resource must be a .univer.html Blob.");
  }
}

export function htmlViewUrls(origin: string, nodeId: string) {
  return {
    workspaceUrl: new URL(`/nodes/${encodeURIComponent(nodeId)}`, origin).href,
    shareUrl: new URL(`/nodes/${encodeURIComponent(nodeId)}?view=immersive`, origin).href,
  };
}

/** HTTP-only read shared by the gateway and the runtime-backed HTML View feature. */
export async function readWorkspaceHtmlView(
  authenticatedHttp: AuthenticatedWorkspaceHttp,
  resourceId: string,
  maxChars: number,
): Promise<WorkspaceHtmlViewPage> {
  if (!Number.isSafeInteger(maxChars) || maxChars < 0)
    throw workspaceError("workspace-argument-invalid", "HTML View read limit must be a nonnegative integer.");
  const blobs = new WorkspaceBlobFeature(authenticatedHttp);
  const view = await blobs.get(resourceId);
  requireHtmlView(view.node.name);
  const tooLarge = () => workspaceError("workspace-result-too-large", "HTML View page is too large to revise inline.");
  if (view.resource.byteSize > maxChars * 4) throw tooLarge();
  const stream = await blobs.downloadStream(resourceId);
  try {
    requireHtmlView(stream.fileName);
    const decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
    let html = "";
    for await (const chunk of stream.content) {
      html += decoder.decode(chunk, { stream: true });
      if (html.length > maxChars) throw tooLarge();
    }
    html += decoder.decode();
    // JSON escaping counts toward the inline MCP result budget too.
    if (JSON.stringify(html).length - 2 > maxChars) throw tooLarge();
    return {
      resourceId: stream.resourceId, nodeId: stream.nodeId, spaceId: stream.spaceId,
      name: stream.fileName, html, etag: stream.etag,
    };
  } catch (error) {
    if (error instanceof TypeError && "code" in error && error.code === "ERR_ENCODING_INVALID_ENCODED_DATA") {
      throw workspaceError("workspace-html-view-invalid", "HTML View page must be valid UTF-8.");
    }
    throw error;
  } finally {
    await stream.close();
  }
}
