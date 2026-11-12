import { z } from "zod";
import type { WorkspaceHtmlViewDraft } from "@univerjs/univer-workspace-client-core/product";

export const htmlViewDraftSchema = z.object({
  id: z.string().min(1),
  kind: z.enum(["create", "replace"]),
  state: z.enum(["pending", "published", "rejected", "expired", "conflicted"]),
  name: z.string(),
  space: z.string(),
  resource: z.string().optional(),
  node: z.string().optional(),
  etag: z.string().regex(/^"[^"\r\n]+"$/).optional(),
  shareUrl: z.url().optional(),
  previewUrl: z.url(),
  expiresAt: z.string(),
});

export const htmlViewDraftOutput = z.object({ draft: htmlViewDraftSchema });

export function htmlViewDraftResult(draft: WorkspaceHtmlViewDraft) {
  return {
    id: draft.id, kind: draft.kind, state: draft.status.state, name: draft.name, space: draft.spaceId,
    previewUrl: draft.previewUrl, expiresAt: draft.expiresAt,
    ...(draft.status.state === "published" ? {
      resource: draft.status.resourceId, node: draft.status.nodeId,
      etag: draft.status.etag, shareUrl: draft.status.shareUrl,
    } : {}),
  };
}
