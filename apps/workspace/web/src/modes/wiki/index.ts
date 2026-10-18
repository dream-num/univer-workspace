import { WikiIssueLayout, WikiIssueListPage, WikiIssueDetailPage } from "./pages/issues";
import { WikiWorktreesPage } from "./pages/worktrees";
import { WikiSpaceTrashPage } from "./pages/trash";
import { WikiTeamMembersPage } from "./pages/members";
import { WikiSpaceSettingsPage } from "./pages/settings";
import { WikiFolderPage } from "./pages/folder";
import { WikiSpacePage } from "./pages/space";
import { WikiHomePage } from "./pages/home";
import { WikiRepositoriesPage } from "./pages/repositories";
import { HtmlAppPage } from "../html-app-page";
import { WikiShell } from "./wiki-shell";
import type { ModeDefinition } from "../registry";

export const wikiMode = {
  pages: {
    apps: HtmlAppPage,
    recent: WikiRepositoriesPage,
    repositories: WikiRepositoriesPage,
    issueList: WikiIssueListPage,
    issueDetail: WikiIssueDetailPage,
    issues: WikiIssueLayout,
    worktrees: WikiWorktreesPage,
    trash: WikiSpaceTrashPage,
    members: WikiTeamMembersPage,
    settings: WikiSpaceSettingsPage,
    folder: WikiFolderPage,
    space: WikiSpacePage,
    home: WikiHomePage,
  },
  label: "wikiTheme",
  Shell: WikiShell,
  messages: {},
} as const satisfies ModeDefinition;
