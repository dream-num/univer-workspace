export type HtmlViewDraftState = "pending" | "published" | "rejected" | "expired" | "conflicted";
export interface HtmlViewDraftView {
  readonly id: string;
  readonly kind: "create" | "replace";
  readonly state: HtmlViewDraftState;
  readonly spaceId: string;
  readonly parentNodeId: string | null;
  readonly name: string;
  readonly targetResourceId: string | null;
  readonly baseEtag: string | null;
  readonly byteSize: number;
  readonly createdAt: string;
  readonly expiresAt: string;
  readonly decidedAt: string | null;
  readonly published: {
    readonly nodeId: string;
    readonly resourceId: string;
    readonly etag: string;
  } | null;
}
export interface DraftRow {
  id: string;
  author_user_id: string;
  idempotency_key: string;
  kind: "create" | "replace";
  space_id: string;
  parent_node_id: string | null;
  name: string;
  target_resource_id: string | null;
  base_etag: string | null;
  object_key: string;
  byte_size: number;
  sha256: string;
  media_type: string | null;
  stored_etag: string | null;
  state: "receiving" | HtmlViewDraftState;
  result_node_id: string | null;
  result_resource_id: string | null;
  result_etag: string | null;
  decided_by: string | null;
  decided_at: number | null;
  expires_at: number;
  created_at: number;
  updated_at: number;
}
