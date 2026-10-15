import type { components } from "../../../generated/http/schema.js";
import type { PropsWithChildren } from "react";

export type HomeView = "recent" | "owned" | "shared";

export interface HomePageProps {
  readonly view?: HomeView;
}

export type SpacePageView = "files" | "prs" | "apps";
export interface SpacePageProps {
  readonly spaceId: string;
  readonly view?: SpacePageView;
}

export interface FolderPageProps {
  readonly detail: components["schemas"]["NodeResponse"];
  readonly searchQuery: string;
  readonly onSearchChange: (value: string) => void;
  readonly username: string | undefined;
}

export interface SpaceSettingsPageProps {
  readonly spaceId: string;
}

export type { WorktreeDashboardSearch as WorktreesPageProps } from "../features/worktrees/worktree-review-search";

export type IssuePageProps = PropsWithChildren<{
  readonly spaceId?: string;
  readonly crumb?: string;
}>;
