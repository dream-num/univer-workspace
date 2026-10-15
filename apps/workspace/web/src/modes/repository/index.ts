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
  pages: { worktrees: RepositoryWorktreesPage, trash: RepositorySpaceTrashPage, members: RepositoryTeamMembersPage, settings: RepositorySpaceSettingsPage, folder: RepositoryFolderPage, space: RepositorySpacePage, home: RepositoryHomePage },
  label: "repositoryTheme",
  Shell: RepositoryShell,
  messages: repositoryMessages,
} as const satisfies ModeDefinition;
