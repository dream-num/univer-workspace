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

  function requireEditor(userId: string, resourceId: string) {
    const html = options.access.resolveResource(userId, resourceId);
    if (
      html?.kind !== "blob" ||
      html.availability !== "ready" ||
      !isHtmlViewFilename(html.originalFilename)
    ) {
      throw new ApplicationError("NOT_FOUND", 404, "HTML view not found.");
    }
    if (!html.capabilities.editContent) {
      throw new ApplicationError("FORBIDDEN", 403, "HTML editor permission is required.");
    }
    return html;
  }

  async function authorize(userId: string, scope: HtmlViewScope, unitId?: string) {
    const html = requireEditor(userId, scope.resourceId);
    if (html.objectKey !== scope.objectKey) {
      throw new ApplicationError("CONFLICT", 409, "HTML template changed; reload the page.");
    }
    const ids = await unitIds(html.objectKey);
    // Reading Blob bytes is asynchronous; recheck before returning authority.
    if (requireEditor(userId, scope.resourceId).objectKey !== scope.objectKey) {
      throw new ApplicationError("CONFLICT", 409, "HTML template changed; reload the page.");
    }
    const publisherId = options.blobs.publicationActor(html.id, html.objectKey);
    if (!publisherId || (unitId !== undefined && !ids.includes(unitId))) {
      throw new ApplicationError("FORBIDDEN", 403, "Sheet is not authorized by this HTML view.");
    }
    for (const id of ids) source(publisherId, id);
    if (unitId === undefined) return undefined;
    const resource = source(publisherId, unitId);
    return {
      ...resource,
      // This delegation grants content editing, never source administration.
      node: { ...resource.node, role: "editor" as const },
    };
  }

  return {
    async open(userId: string, resourceId: string): Promise<HtmlViewScope> {
      const html = requireEditor(userId, resourceId);
      const scope = { resourceId, objectKey: html.objectKey };
      await authorize(userId, scope);
      return scope;
    },
    authorize,
    async validatePublication(userId: string, objectKey: string, filename: string) {
      if (!isHtmlViewFilename(filename)) return;
      for (const unitId of await unitIds(objectKey)) source(userId, unitId);
    },
  };
}

export type HtmlViewsModule = ReturnType<typeof createHtmlViewsModule>;
