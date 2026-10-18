import { useQuery } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import {
  ArrowRight,
  BookMarked,
  CircleDot,
  Clock3,
  CornerDownLeft,
  Download,
  GitPullRequest,
  Globe,
  House,
} from "lucide-react";
import { useState } from "react";
import { sessionQueryOptions } from "../../features/auth";
import { spacesQueryOptions } from "../../features/spaces";
import { AGENT_DOWNLOAD_URL } from "../../features/worktrees/worktree-onboarding";
import { useI18n, type MessageKey } from "../../shared/i18n";
import { Avatar, Button } from "../../shared/ui";
import type { RepositoryGlobalView } from "../shell.types";
import { RepositorySearchField } from "./repository-controls";
import { filterRepositories } from "./repository-directory";
import { spaceDisplayName } from "./space-name";

const entries = [
  { view: "home", to: "/home", label: "home", icon: House },
  { view: "worktrees", to: "/worktrees", label: "repositoryPullRequests", icon: GitPullRequest },
  { view: "issues", to: "/issues", label: "issues", icon: CircleDot },
  { view: "recent", to: "/recent", label: "recent", icon: Clock3 },
  { view: "apps", to: "/apps", label: "pages", icon: Globe },
] as const satisfies readonly {
  view: RepositoryGlobalView;
  to: string;
  label: MessageKey;
  icon: typeof House;
}[];

export function RepositoryGlobalNavigation({ view }: { readonly view: RepositoryGlobalView }) {
  const { t, language } = useI18n();
  const session = useQuery(sessionQueryOptions);
  const spaces = useQuery(spacesQueryOptions);
  const [q, setQ] = useState("");
  const items = filterRepositories(
    spaces.data?.spaces ?? [],
    { q },
    (space) => spaceDisplayName(space, t) ?? space.name,
    language,
  );
  const user = session.data?.authenticated ? session.data.user : undefined;
  return (
    <div className="repository-global-navigation">
      {user ? (
        <div className="repository-nav-account">
          <Avatar src={user.avatarUrl} name={user.displayName} />
          <div className="min-w-0">
            <p className="truncate font-semibold">{user.username}</p>
            <p className="text-xs text-muted-foreground">{t("dashboardPersonalAccount")}</p>
          </div>
        </div>
      ) : null}
      <nav aria-label={t("mainNavigation")} className="repository-global-links">
        {entries.map(({ view: item, to, label, icon: Icon }) => (
          <Link key={item} to={to} search={{}} aria-current={view === item ? "page" : undefined}>
            <Icon aria-hidden="true" />
            {t(label)}
          </Link>
        ))}
      </nav>
      <section className="repository-sidebar-repos" aria-label={t("dashboardMyRepositories")}>
        <h2 className="mb-3 text-sm font-semibold">{t("dashboardMyRepositories")}</h2>
        <RepositorySearchField value={q} onChange={setQ} label={t("searchRepositories")} />
        <ul>
          {items.slice(0, 8).map((space) => (
            <li key={space.id}>
              <Link to="/spaces/$spaceId" params={{ spaceId: space.id }} search={{}}>
                <BookMarked aria-hidden="true" />
                <span className="truncate">{spaceDisplayName(space, t)}</span>
              </Link>
            </li>
          ))}
        </ul>
        {!items.length ? (
          <p className="py-3 text-xs text-muted-foreground">
            {t(q ? "repositoriesNoMatch" : "repositoriesEmpty")}
          </p>
        ) : null}
        <Link
          className="repository-all-link"
          to="/repositories"
          search={q ? { q } : {}}
          aria-current={view === "repositories" ? "page" : undefined}
        >
          {t("dashboardAllRepositories")}
          <ArrowRight aria-hidden="true" />
        </Link>
      </section>
      <section className="repository-sidebar-guide">
        <h2>{t("dashboardAgentTitle")}</h2>
        <p>{t("dashboardAgentDescription")}</p>
        <a
          className="repository-secondary-link"
          href={AGENT_DOWNLOAD_URL}
          target="_blank"
          rel="noopener noreferrer"
        >
          <Download aria-hidden="true" />
          {t("onboardingDownload")}
        </a>
      </section>
    </div>
  );
}

export function RepositoryHeaderSearch() {
  const [q, setQ] = useState("");
  const { t } = useI18n();
  const navigate = useNavigate();
  return (
    <form
      className="repository-header-search"
      role="search"
      onSubmit={(event) => {
        event.preventDefault();
        void navigate({ to: "/repositories", search: q ? { q } : {} });
      }}
    >
      <RepositorySearchField value={q} onChange={setQ} label={t("searchRepositories")} />
      <Button variant="ghost" size="icon" type="submit" aria-label={t("searchRepositories")}>
        <CornerDownLeft aria-hidden="true" />
      </Button>
    </form>
  );
}
