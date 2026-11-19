export interface RecentCursor {
  readonly timestamp: number;
  readonly id: string;
}

export interface RecentRow {
  readonly resource_id: string;
  readonly last_opened_at: number;
}

export interface OwnedRow {
  readonly resource_id: string;
  readonly updated_at: number;
}

export interface BreadcrumbRow {
  readonly id: string;
  readonly name: string;
}

export interface SharedRow {
  readonly node_id: string;
  readonly shared_at: number;
  readonly shared_by_id: string;
  readonly shared_by_username: string;
  readonly shared_by_display_name: string;
  readonly shared_by_avatar_url: string | null;
}

export interface ViewsRepository {
  listRecent(userId: string, cursor: RecentCursor | null, limit: number): Promise<RecentRow[]>;
  listHtmlViews(userId: string, cursor: RecentCursor | null, limit: number, spaceId?: string): Promise<OwnedRow[]>;
  listOwned(userId: string, cursor: RecentCursor | null, limit: number): Promise<OwnedRow[]>;
  breadcrumbs(nodeId: string): Promise<BreadcrumbRow[]>;
  listShared(userId: string, cursor: RecentCursor | null, limit: number): Promise<SharedRow[]>;
}
