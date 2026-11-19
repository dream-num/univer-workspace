import type {
  IssuePageProps,
  IssueListPageProps,
  IssueDetailPageProps,
  WorktreesPageProps,
  SpaceSettingsPageProps,
  FolderPageProps,
  SpacePageProps,
  HomePageProps,
  RecentPageProps,
} from "./page.types";
import type { ComponentType } from "react";
import type { RepositorySearch } from "./repository/repository-directory";
import type { WorkspaceShellProps } from "./shell.types";
import type { MessageKey, ModeMessages } from "../shared/i18n";
import { parseUiMode, useUiMode } from "../shared/ui-mode";
import { repositoryMode } from "./repository";
import { wikiMode } from "./wiki";

export interface ModeDefinition {
  readonly pages: {
    readonly repositories: ComponentType<RepositorySearch>;
    readonly recent: ComponentType<RecentPageProps>;
    readonly issueList: ComponentType<IssueListPageProps>;
    readonly issueDetail: ComponentType<IssueDetailPageProps>;
    readonly issues: ComponentType<IssuePageProps>;
    readonly worktrees: ComponentType<WorktreesPageProps>;
    readonly trash: ComponentType<SpaceSettingsPageProps>;
    readonly members: ComponentType<SpaceSettingsPageProps>;
    readonly settings: ComponentType<SpaceSettingsPageProps>;
    readonly folder: ComponentType<FolderPageProps>;
    readonly space: ComponentType<SpacePageProps>;
    readonly home: ComponentType<HomePageProps>;
    readonly agents: ComponentType<{ readonly spaceId: string; readonly prompt?: string | undefined }>;
    readonly agentSession: ComponentType<{ readonly sessionId: string }>;
  };
  readonly Shell: ComponentType<WorkspaceShellProps>;
  readonly label: MessageKey;
  readonly description: MessageKey;
  readonly shortDescription: MessageKey;
  readonly preview: string;
  readonly messages: ModeMessages;
}

export const modes = {
  wiki: wikiMode,
  repository: repositoryMode,
} as const satisfies Record<string, ModeDefinition>;

export type WorkspaceMode = keyof typeof modes;
export const MODE_IDS = Object.keys(modes) as readonly WorkspaceMode[];

export function useModeDefinition() {
  const { mode } = useUiMode();
  return modes[parseUiMode(mode, MODE_IDS, "repository")];
}

export type { RepositoryTab, RepositoryBreadcrumb } from "./repository/repository-tabs";
export { parseRepositorySearch } from "./repository/repository-directory";

export { ModeOnboarding } from "./mode-onboarding";
export { WorkspaceLayout } from "./workspace-layout";
export type { WorkspaceShellProps } from "./shell.types";
export type { IssuePageProps, HomeView, SpacePageView } from "./page.types";
