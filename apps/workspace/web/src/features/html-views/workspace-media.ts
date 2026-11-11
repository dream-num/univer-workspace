/** Authors reference a Workspace media Node by ID instead of writing a fetchable URL. */
export const workspaceMediaAttribute = "data-workspace-src";
const blobContentPrefix = "/api/blob-resources/";
const mediaSelector = ["video", "audio", "source", "img"]
  .map((tag) => `${tag}[${workspaceMediaAttribute}]:not([src])`)
  .join(",");
const mediaTypes = /^(video|audio|image)\//;

/** The only route the HTML view sandbox may load images and audio/video from. */
export function workspaceMediaSources(origin: string): readonly string[] {
  return [`${origin}${blobContentPrefix}`];
}

/**
 * Points `data-workspace-src="<nodeId>"` media elements at their Blob content. A reference
 * resolves only when the Node is readable anonymously (link-shared), and both the lookup
 * and the sandbox's own media request carry no session: whoever can edit the page could
 * otherwise reference media they cannot read and have a viewer load it for them.
 * Unresolved references stay as written and issue no request.
 */
export async function resolveWorkspaceMedia(
  source: string,
  origin: string,
  signal: AbortSignal,
): Promise<string> {
  if (!source.includes(workspaceMediaAttribute)) return source;
  const document = new DOMParser().parseFromString(source, "text/html");
  const elements = mediaElements(document);
  const nodeIds = [...new Set(elements.map(nodeIdOf).filter(Boolean))];
  if (!nodeIds.length) return source;
  const resolved = new Map(
    await Promise.all(nodeIds.map(async (nodeId) => [nodeId, await publicMediaUrl(nodeId, origin, signal)] as const)),
  );
  let changed = false;
  for (const element of elements) {
    const url = resolved.get(nodeIdOf(element));
    if (!url) continue;
    element.removeAttribute(workspaceMediaAttribute);
    element.setAttribute("src", url);
    changed = true;
  }
  return changed ? `<!doctype html>\n${document.documentElement.outerHTML}` : source;
}

function mediaElements(root: ParentNode): Element[] {
  const found = [...root.querySelectorAll(mediaSelector)];
  for (const template of root.querySelectorAll("template")) {
    found.push(...mediaElements(template.content));
  }
  return found;
}

function nodeIdOf(element: Element): string {
  return element.getAttribute(workspaceMediaAttribute)?.trim() ?? "";
}

async function publicMediaUrl(nodeId: string, origin: string, signal: AbortSignal): Promise<string | null> {
  try {
    const response = await fetch(`${origin}/api/nodes/${encodeURIComponent(nodeId)}`, {
      credentials: "omit",
      signal,
    });
    if (!response.ok) return null;
    const body = (await response.json()) as {
      node?: { resource?: { id?: string; kind?: string; mediaType?: string; availability?: string } | null };
    };
    const resource = body.node?.resource;
    if (!resource?.id || resource.kind !== "blob" || resource.availability !== "ready") return null;
    if (!mediaTypes.test(resource.mediaType ?? "")) return null;
    return `${origin}${blobContentPrefix}${encodeURIComponent(resource.id)}/content`;
  } catch (error) {
    if (signal.aborted) throw error;
    return null;
  }
}
