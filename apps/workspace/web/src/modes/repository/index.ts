import "./styles.css";
import "./dashboard.css";
import { RepositoryDirectoryPage } from "./pages/repositories";
import { RepositoryRecentPage } from "./pages/recent";
import { RepositoryAppsPage } from "./pages/apps";
import {
  RepositoryIssueLayout,
  RepositoryIssueListPage,
  RepositoryIssueDetailPage,
} from "./pages/issues";
import { RepositoryWorktreesPage } from "./pages/worktrees";
import { RepositorySpaceTrashPage } from "./pages/trash";
import { RepositoryTeamMembersPage } from "./pages/members";
import { RepositorySpaceSettingsPage } from "./pages/settings";
import { RepositoryFolderPage } from "./pages/folder";
import { RepositorySpacePage } from "./pages/space";
import { RepositoryHomePage } from "./pages/home";
import { RepositoryShell } from "./repository-shell";
import type { ModeDefinition } from "../registry";
import { repositoryMessages } from "./messages";

export const repositoryMode = {
  pages: {
    apps: RepositoryAppsPage,
    recent: RepositoryRecentPage,
    repositories: RepositoryDirectoryPage,
    issueList: RepositoryIssueListPage,
    issueDetail: RepositoryIssueDetailPage,
    issues: RepositoryIssueLayout,
    worktrees: RepositoryWorktreesPage,
    trash: RepositorySpaceTrashPage,
    members: RepositoryTeamMembersPage,
    settings: RepositorySpaceSettingsPage,
    folder: RepositoryFolderPage,
    space: RepositorySpacePage,
    home: RepositoryHomePage,
  },
  label: "repositoryTheme",
  Shell: RepositoryShell,
  messages: repositoryMessages,
} as const satisfies ModeDefinition;
