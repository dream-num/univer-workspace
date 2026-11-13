/**
 * Which repository tab a space-scoped route belongs to. Routes inside a
 * repository pass this instead of `selectedView` so the shell keeps its
 * repository chrome (breadcrumb, tabs) after leaving the repository root.
 */
export type RepositoryTab = "files" | "agents" | "issues" | "prs" | "apps" | "settings";

export type RepositoryBreadcrumb = {
  readonly label: string;
  readonly nodeId?: string;
  /** Set inside Settings so the segment links back to the settings page. */
  readonly settingsSpaceId?: string;
  /** Set inside an Issue page so the segment links back to that Space's Issue list. */
  readonly issuesSpaceId?: string;
};
