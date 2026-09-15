import { getHtmlViewUnitIds, isHtmlViewFilename, parseHtmlView } from "@univerjs-labs/html-view";
import type { BlobStore } from "../../integrations/blob/blob-store.js";
import { ApplicationError } from "../../middleware/errors.js";
import type { AccessResolver, UniverResourceAccess } from "../access/index.js";
import type { BlobsRepository } from "../blobs/blobs.repository.js";

/** Server-created context, bound to one immutable published HTML object. */
export interface HtmlViewScope {
  readonly resourceId: string;
  readonly objectKey: string;
}

export function createHtmlViewsModule(options: {
  readonly access: AccessResolver;
  readonly store: BlobStore;
  readonly blobs: BlobsRepository;
}) {
  // Object keys are immutable. Cache declarations, never permission decisions.
  const declarations = new Map<string, readonly string[]>();
  async function unitIds(objectKey: string): Promise<readonly string[]> {
    const cached = declarations.get(objectKey);
    if (cached) return cached;
    const { stream } = await options.store.open({ objectKey });
    const chunks: Buffer[] = [];
    for await (const chunk of stream) chunks.push(Buffer.from(chunk));
    let ids: readonly string[];
    try {
      ids = getHtmlViewUnitIds(parseHtmlView(Buffer.concat(chunks).toString("utf8")));
    } catch {
      throw new ApplicationError("INVALID_INPUT", 400, "Invalid HTML view template.");
    }
    if (declarations.size >= 64) declarations.delete(declarations.keys().next().value!);
    declarations.set(objectKey, ids);
    return ids;
  }

  function source(publisherId: string, unitId: string): UniverResourceAccess {
    const resource = options.access.resolveUnit(publisherId, unitId);
    if (
      resource?.kind !== "univer" ||
      resource.unitType !== "sheet" ||
      !resource.capabilities.editContent
    ) {
      throw new ApplicationError(
        "FORBIDDEN",
        403,
        "The HTML publisher must be able to edit each referenced Sheet.",
      );
    }
    return resource;
  }

  function requireView(userId: string, resourceId: string) {
    const html = options.access.resolveResource(userId, resourceId);
    if (
      html?.kind !== "blob" ||
      html.availability !== "ready" ||
      !isHtmlViewFilename(html.originalFilename)
    ) {
      throw new ApplicationError("NOT_FOUND", 404, "HTML view not found.");
    }
    return html;
  }

  async function publishedSources(userId: string, scope: HtmlViewScope) {
    const html = requireView(userId, scope.resourceId);
    if (html.objectKey !== scope.objectKey) {
      throw new ApplicationError("CONFLICT", 409, "HTML template changed; reload the page.");
    }
    const ids = await unitIds(html.objectKey);
    // Reading Blob bytes is asynchronous; recheck before returning authority.
    if (requireView(userId, scope.resourceId).objectKey !== scope.objectKey) {
      throw new ApplicationError("CONFLICT", 409, "HTML template changed; reload the page.");
    }
    const publication = options.blobs.htmlPublication(html.id, html.objectKey);
    if (!publication) {
      throw new ApplicationError("FORBIDDEN", 403, "HTML publication not found.");
    }
    // Templates published before source provenance was recorded use their actual publisher.
    const publishers =
      publication.sourcePublishers === undefined
        ? new Map(ids.map((id) => [id, publication.actorId]))
        : new Map(Object.entries(publication.sourcePublishers));
    return new Map(ids.map((id) => [id, publishers.get(id)]));
  }

  async function authorize(userId: string, scope: HtmlViewScope, unitId?: string) {
    const publishers = await publishedSources(userId, scope);
    if (unitId !== undefined && !publishers.has(unitId)) {
      throw new ApplicationError("FORBIDDEN", 403, "Sheet is not authorized by this HTML view.");
    }
    let requested: UniverResourceAccess | undefined;
    for (const [id, publisherId] of publishers) {
      if (!publisherId) {
        throw new ApplicationError("FORBIDDEN", 403, "Sheet publication authority is missing.");
      }
      const resource = source(publisherId, id);
      if (id === unitId) requested = resource;
    }
    if (!requested) return undefined;
    return {
      ...requested,
      // Page execution grants content editing, never source administration.
      node: { ...requested.node, role: "editor" as const },
    };
  }

  return {
    open(userId: string, resourceId: string): HtmlViewScope {
      const html = requireView(userId, resourceId);
      // Capture the current version; each data request and connection checks its source authority.
      return { resourceId, objectKey: html.objectKey };
    },
    authorize,
    async validatePublication(
      userId: string,
      objectKey: string,
      filename: string,
      previous?: HtmlViewScope,
    ): Promise<Readonly<Record<string, string>> | undefined> {
      if (!isHtmlViewFilename(filename)) return;
      const ids = await unitIds(objectKey);
      const inherited = previous
        ? await publishedSources(userId, previous)
        : new Map<string, string | undefined>();
      return Object.fromEntries(
        ids.map((id) => {
          const publisherId = inherited.get(id) ?? userId;
          source(publisherId, id);
          return [id, publisherId];
        }),
      );
    },
  };
}

export type HtmlViewsModule = ReturnType<typeof createHtmlViewsModule>;
