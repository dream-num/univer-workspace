import { useQuery } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { CircleDot, GitPullRequest, MessageCircle, Moon, Search, Sun } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { spaceQueryOptions } from "../../../features/spaces";
import { workspaceHarnessOrigin } from "../../../shared/app-links";
import { useI18n } from "../../../shared/i18n";
import { useTheme } from "../../../shared/theme";
import type { WorkspaceShellProps } from "../../shell.types";
import { CurrentLink } from "../current-link";
import { BRAND, OfficeLabMark } from "../brand";
import { spaceDisplayName } from "../space-name";
import type { Frame } from "./frame";

export type TopBarProps = Pick<
  WorkspaceShellProps,
  "selectedSpaceId" | "repositoryBreadcrumbs" | "headerTitle" | "headerContent" | "headerActions"
> & {
  readonly frame: Exclude<Frame, { kind: "immersive" }>;
  readonly account: ReactNode;
};

const links = [
  { view: "home", to: "/home", label: "home" },
  { view: "worktrees", to: "/worktrees", label: "repositoryPullRequests" },
  { view: "issues", to: "/issues", label: "issues" },
  { view: "recent", to: "/recent", label: "recent" },
  { view: "apps", to: "/apps", label: "pages" },
] as const;

export function TopBar({
  frame,
  account,
  selectedSpaceId,
  repositoryBreadcrumbs,
  headerTitle,
  headerContent,
  headerActions,
}: TopBarProps) {
  const { t } = useI18n();
  const { resolvedTheme, setTheme } = useTheme();
  const selected = useQuery(spaceQueryOptions(selectedSpaceId));
  const navigate = useNavigate();
  const [q, setQ] = useState("");
  const input = useRef<HTMLInputElement>(null);
  const nav = useRef<HTMLElement>(null);
  const documentFrame = frame.kind === "document";
  const view =
    frame.kind === "home"
      ? "home"
      : frame.kind === "global"
        ? frame.view
        : frame.kind === "repository"
          ? (
              {
                issues: "issues",
                prs: "worktrees",
                apps: "apps",
                files: undefined,
                settings: undefined,
              } as const
            )[frame.tab]
          : undefined;
  const space = selected.data;
  const name = spaceDisplayName(space, t) ?? space?.name;
  const crumbs = [...(repositoryBreadcrumbs ?? [])];
  if (typeof headerTitle === "string" && crumbs.at(-1)?.label === headerTitle) crumbs.pop();
  const crumbTitle = frame.kind === "global" && crumbs.length === 0 ? undefined : headerTitle;
  const harnessOrigin = workspaceHarnessOrigin();

  useEffect(() => {
    if (documentFrame) return;
    const focusSearch = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        input.current?.focus();
      }
    };
    window.addEventListener("keydown", focusSearch);
    return () => window.removeEventListener("keydown", focusSearch);
  }, [documentFrame]);
  useEffect(() => {
    nav.current
      ?.querySelector('[aria-current="page"]')
      ?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [view]);

  return (
    <header className={`rd-top${documentFrame ? " rd-top-document" : ""}`}>
      <Link className="rd-brand" to="/home" aria-label={BRAND}>
        <OfficeLabMark />
        {BRAND}
      </Link>
      {frame.kind !== "home" && (space || crumbs.length > 0 || crumbTitle) ? (
        <nav className="rd-crumbs" aria-label={t("repositoryBreadcrumbNavigation")}>
          {space && selectedSpaceId ? (
            <>
              {space.owner ? (
                <>
                  <Link className="rd-crumb-owner" to="/home">{space.owner.username}</Link>
                  <span className="rd-sep">/</span>
                </>
              ) : null}
              <Link className="rd-crumb-repository" to="/spaces/$spaceId" params={{ spaceId: selectedSpaceId }} search={{}}>
                <b>{space.slug ?? name}</b>
              </Link>
            </>
          ) : null}
          {crumbs.map((crumb, index) => (
            <span className="rd-crumb" key={`${crumb.label}-${index}`}>
              <span className="rd-sep">/</span>
              {crumb.nodeId ? (
                <Link to="/nodes/$nodeId" params={{ nodeId: crumb.nodeId }} search={{}}>
                  {crumb.label}
                </Link>
              ) : crumb.issuesSpaceId ? (
                <Link
                  to="/spaces/$spaceId/issues"
                  params={{ spaceId: crumb.issuesSpaceId }}
                  search={{}}
                >
                  {crumb.label}
                </Link>
              ) : crumb.settingsSpaceId ? (
                <Link to="/spaces/$spaceId/settings" params={{ spaceId: crumb.settingsSpaceId }}>
                  {crumb.label}
                </Link>
              ) : (
                <span>{crumb.label}</span>
              )}
            </span>
          ))}
          {crumbTitle ? (
            <span className="rd-crumb">
              <span className="rd-sep">/</span>
              <span>{crumbTitle}</span>
            </span>
          ) : null}
        </nav>
      ) : null}
      {!documentFrame ? (
        <>
          <form
            className="rd-search"
            role="search"
            onSubmit={(event) => {
              event.preventDefault();
              void navigate({ to: "/repositories", search: q ? { q } : {} });
            }}
          >
            <Search aria-hidden="true" />
            <input
              ref={input}
              type="search"
              aria-label={t("searchRepositories")}
              placeholder={t("repositorySearchShort")}
              autoComplete="off"
              value={q}
              onChange={(event) => setQ(event.target.value)}
            />
            <kbd>{/Mac|iPhone|iPad/.test(navigator.platform) ? "⌘" : "Ctrl"}</kbd>
            <kbd>K</kbd>
          </form>
          <nav ref={nav} className="rd-nav" aria-label={t("mainNavigation")}>
            {links.map((link) => (
              <CurrentLink
                key={link.view}
                to={link.to}
                search={{}}
                current={view === link.view}
              >
                {t(link.label)}
              </CurrentLink>
            ))}
          </nav>
        </>
      ) : null}
      <div className="rd-tools">
        {headerContent}
        {headerActions}
        <Link
          className="rd-iconbtn rd-shortcut"
          to="/issues"
          search={{}}
          aria-label={t("issues")}
          title={t("issues")}
        >
          <CircleDot aria-hidden="true" />
        </Link>
        <Link
          className="rd-iconbtn rd-shortcut"
          to="/worktrees"
          search={{}}
          aria-label={t("repositoryPullRequests")}
          title={t("repositoryPullRequests")}
        >
          <GitPullRequest aria-hidden="true" />
        </Link>
        <button
          className="rd-iconbtn rd-shortcut"
          type="button"
          aria-label={t(resolvedTheme === "dark" ? "themeLight" : "themeDark")}
          title={t(resolvedTheme === "dark" ? "themeLight" : "themeDark")}
          onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}
        >
          {resolvedTheme === "dark" ? <Sun aria-hidden="true" /> : <Moon aria-hidden="true" />}
        </button>
        {harnessOrigin ? (
          <button
            className="rd-iconbtn rd-shortcut"
            type="button"
            aria-label={t("openChat")}
            title={t("openChat")}
            onClick={() => window.open(harnessOrigin, "_blank", "noopener,noreferrer")}
          >
            <MessageCircle aria-hidden="true" />
          </button>
        ) : null}
        <div className="rd-me">{account}</div>
      </div>
    </header>
  );
}
