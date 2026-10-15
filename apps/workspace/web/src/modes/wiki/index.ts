import { WikiHomePage } from "./pages/home";
import { WikiShell } from "./wiki-shell";
import type { ModeDefinition } from "../registry";

export const wikiMode = {
  pages: { home: WikiHomePage },
  label: "wikiTheme",
  Shell: WikiShell,
  messages: {},
} as const satisfies ModeDefinition;
