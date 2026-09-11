/**
 * Type definitions for the Univer Workspace Control Plane.
 */

export interface User {
  id: string;
  username: string;
  display_name: string;
  avatar_url: string | null;
  created_at: number;
  updated_at: number;
}

export interface PasswordCredential {
  user_id: string;
  password_hash: string;
  created_at: number;
  updated_at: number;
}

export interface LoginSession {
  id: string;
  secret_hash: string;
  user_id: string;
  created_at: number;
  expires_at: number;
}

export type SpaceType = "personal" | "team";

export interface Space {
  id: string;
  type: SpaceType;
  name: string;
  owner_user_id: string;
  created_at: number;
  updated_at: number;
  public_read: number;
}

export type SpaceRole = "admin" | "editor" | "viewer";

export interface SpaceMember {
  space_id: string;
  user_id: string;
  role: SpaceRole;
  granted_by: string;
  created_at: number;
  updated_at: number;
}

export interface NodeItem {
  id: string;
  space_id: string;
  parent_id: string | null;
  name: string;
  created_by: string;
  trash_batch_id: string | null;
  created_at: number;
  updated_at: number;
}

export type ResourceKind = "univer" | "blob";

export interface ResourceItem {
  id: string;
  node_id: string;
  kind: ResourceKind;
  created_at: number;
  updated_at: number;
}

export type UniverUnitType = "sheet" | "doc" | "slide" | "board" | "base";

export interface UniverResource {
  resource_id: string;
  unit_id: string;
  unit_type: UniverUnitType;
}

export interface BlobResource {
  resource_id: string;
  object_key: string;
  original_filename: string;
  media_type: string;
  byte_size: number;
  sha256: string;
  etag: string;
  availability: "ready" | "quarantined";
  created_at: number;
  updated_at: number;
}

export interface NodeLinkSharing {
  node_id: string;
  enabled: number;
  role: "editor" | "viewer";
  created_by: string;
  updated_by: string;
  created_at: number;
  updated_at: number;
}

export interface NodeGrant {
  node_id: string;
  user_id: string;
  role: "editor" | "viewer";
  granted_by: string;
  created_at: number;
  updated_at: number;
}

export interface TrashBatch {
  id: string;
  space_id: string;
  root_node_id: string;
  created_by: string;
  created_at: number;
  restored_at: number | null;
}

export interface RecentResource {
  user_id: string;
  resource_id: string;
  last_opened_at: number;
}

export interface WorktreeItem {
  id: string;
  name: string;
  summary: string | null;
  creator_user_id: string;
  kind: "user" | "team";
  team_space_id: string | null;
  visibility: "private" | "space";
  processed_at: number | null;
  created_at: number;
  updated_at: number;
}

export interface BlobUploadSession {
  id: string;
  operation_id: string;
  actor_user_id: string;
  target_space_id: string;
  target_parent_node_id: string | null;
  node_id: string;
  resource_id: string;
  object_key: string;
  node_name: string;
  original_filename: string;
  declared_media_type: string | null;
  detected_media_type: string | null;
  byte_size: number;
  received_size: number | null;
  sha256: string | null;
  etag: string | null;
  state: "waiting_for_upload" | "uploaded" | "verifying" | "completed" | "failed" | "expired" | "aborted";
  expires_at: number;
  created_at: number;
  updated_at: number;
  completed_at: number | null;
  last_error_code: string | null;
}
