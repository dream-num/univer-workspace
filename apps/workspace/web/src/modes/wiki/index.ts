import { WikiFolderPage } from "./pages/folder";
import { WikiSpacePage } from "./pages/space";
import { WikiHomePage } from "./pages/home";
import { WikiShell } from "./wiki-shell";
import type { ModeDefinition } from "../registry";

export const wikiMode = {
  pages: { folder: WikiFolderPage, space: WikiSpacePage, home: WikiHomePage },
  label: "wikiTheme",
  Shell: WikiShell,
  messages: {},
} as const satisfies ModeDefinition;
