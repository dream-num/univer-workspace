import { useQuery } from "@tanstack/react-query";
import { Link, useLocation, useNavigate } from "@tanstack/react-router";
import {
  ChevronRightIcon,
  FolderIcon,
  HtmlViewIcon,
  UserIcon,
  UsersIcon,
} from "@univerjs/univer-workspace-ui";
import { useCallback, useEffect, useState } from "react";
import { useI18n } from "../../shared/i18n";
import { cn } from "../../shared/utils/cn";
import { htmlViewsQueryOptions } from "../views/html-views.queries";
import {
  appTitle,
  buildAppTree,
  selectedHtmlView,
  spaceLabel,
  type AppTreeFolder,
  type AppTreeItem,
  type AppTreeSpace,
} from "./app-tree";

export function AppsSidebarSection(props: { readonly storageScope: string }) {
  const { t } = useI18n();
  const navigate = useNavigate();
  const location = useLocation();
  const onApps = location.pathname === "/apps";
  const routeSearch = onApps ? readAppsSearch(location.search) : {};
  const query = useQuery(htmlViewsQueryOptions);
  const items = query.data?.items ?? [];
  const tree = buildAppTree(items);
  const selected = onApps ? selectedHtmlView(items, routeSearch.node) : undefined;
  const [sectionExpanded, setSectionExpanded] = useStoredExpanded(
    `workspace-file-tree:${props.storageScope}:apps`,
    true,
  );
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set());
  const selectedNodeId = selected?.node.id;
  const selectedSpaceId = tree.length > 1 ? selected?.location.space.id : undefined;
  const selectedFolderKey =
    selected?.location.breadcrumbs.map((breadcrumb) => breadcrumb.id).join("\0") ?? "";

  useEffect(() => {
    if (!selectedNodeId) return;
    setSectionExpanded(true);
    setExpanded((current) => {
      const next = new Set(current);
      let changed = false;
      const ensure = (id: string) => {
        if (next.has(id)) return;
        next.add(id);
        changed = true;
      };
      if (selectedSpaceId) ensure(selectedSpaceId);
      for (const id of selectedFolderKey.split("\0")) {
        if (id) ensure(id);
      }
      return changed ? next : current;
    });
  }, [selectedFolderKey, selectedNodeId, selectedSpaceId, setSectionExpanded]);

  const openNode = (nodeId: string) => {
    void navigate({
      to: "/apps",
      search: { node: nodeId },
    });
  };

  return (
    <section className="mt-1 min-w-0" aria-label={t("apps")}>
      <div className="flex min-h-8 items-center rounded-md pr-0.5 pl-1.5">
        <button
          type="button"
          className="grid size-3.5 shrink-0 place-items-center rounded-sm text-subtle-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/40"
          aria-expanded={sectionExpanded}
          aria-label={t(sectionExpanded ? "collapseSection" : "expandSection", { name: t("apps") })}
          onClick={() => setSectionExpanded(!sectionExpanded)}
        >
          <ChevronRightIcon
            className={cn(
              "size-3.5 transition-transform motion-reduce:transition-none",
              sectionExpanded && "rotate-90",
            )}
          />
        </button>
        <Link
          to="/apps"
          search={{}}
          className="ml-[5px] flex h-8 min-w-0 flex-1 items-center truncate text-xs font-semibold text-subtle-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/40"
          onClick={() => setSectionExpanded(true)}
        >
          {t("apps")}
        </Link>
      </div>
      {sectionExpanded ? (
        query.isPending ? null : tree.length === 0 ? (
          <p className="m-0 py-1.5 pl-2.5 text-xs text-subtle-foreground">{t("appsEmpty")}</p>
        ) : tree.length === 1 ? (
          <AppTreeFolders
            folders={tree[0]?.folders ?? []}
            files={tree[0]?.files ?? []}
            depth={0}
            expanded={expanded}
            selectedNodeId={selected?.node.id}
            onToggle={(id) => toggleExpanded(id, setExpanded)}
            onOpen={openNode}
          />
        ) : (
          tree.map((space) => (
            <AppTreeSpaceRow
              key={space.id}
              space={space}
              label={spaceLabel(space, t)}
              expanded={expanded.has(space.id)}
              expandedIds={expanded}
              selectedNodeId={selected?.node.id}
              onToggle={() => toggleExpanded(space.id, setExpanded)}
              onToggleFolder={(id) => toggleExpanded(id, setExpanded)}
              onOpen={openNode}
            />
          ))
        )
      ) : null}
    </section>
  );
}

function AppTreeSpaceRow({
  space,
  label,
  expanded,
  expandedIds,
  selectedNodeId,
  onToggle,
  onToggleFolder,
  onOpen,
}: {
  readonly space: AppTreeSpace;
  readonly label: string;
  readonly expanded: boolean;
  readonly expandedIds: ReadonlySet<string>;
  readonly selectedNodeId: string | undefined;
  readonly onToggle: () => void;
  readonly onToggleFolder: (id: string) => void;
  readonly onOpen: (nodeId: string) => void;
}) {
  return (
    <div>
      <div className="flex min-h-8 items-center rounded-md pr-0.5 text-secondary-foreground hover:bg-accent hover:text-foreground">
        <TreeToggle expanded={expanded} name={label} onClick={onToggle} />
        <button
          type="button"
          className="flex min-h-8 min-w-0 flex-1 items-center gap-2 px-1 text-left text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
          onClick={onToggle}
        >
          {space.type === "team" ? (
            <UsersIcon className="size-4 shrink-0 text-muted-foreground" />
          ) : (
            <UserIcon className="size-4 shrink-0 text-muted-foreground" />
          )}
          <span className="truncate">{label}</span>
        </button>
      </div>
      {expanded ? (
        <div className="ms-[18px]">
          <AppTreeFolders
            folders={space.folders}
            files={space.files}
            depth={0}
            expanded={expandedIds}
            selectedNodeId={selectedNodeId}
            onToggle={onToggleFolder}
            onOpen={onOpen}
          />
        </div>
      ) : null}
    </div>
  );
}

function AppTreeFolders({
  folders,
  files,
  depth,
  expanded,
  selectedNodeId,
  onToggle,
  onOpen,
}: {
  readonly folders: readonly AppTreeFolder[];
  readonly files: readonly AppTreeItem[];
  readonly depth: number;
  readonly expanded: ReadonlySet<string>;
  readonly selectedNodeId: string | undefined;
  readonly onToggle: (id: string) => void;
  readonly onOpen: (nodeId: string) => void;
}) {
  return (
    <>
      {folders.map((folder) => {
        const open = expanded.has(folder.id);
        return (
          <div key={folder.id}>
            <div
              className="flex min-h-8 items-center rounded-md pr-0.5 text-secondary-foreground hover:bg-accent hover:text-foreground"
              style={depth === 0 ? undefined : { marginInlineStart: depth * 18 }}
            >
              <TreeToggle expanded={open} name={folder.name} onClick={() => onToggle(folder.id)} />
              <button
                type="button"
                className="flex min-h-8 min-w-0 flex-1 items-center gap-2 px-1 text-left text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
                onClick={() => onToggle(folder.id)}
              >
                <FolderIcon className="size-4 shrink-0" />
                <span className="truncate">{folder.name}</span>
              </button>
            </div>
            {open ? (
              <AppTreeFolders
                folders={folder.folders}
                files={folder.files}
                depth={depth + 1}
                expanded={expanded}
                selectedNodeId={selectedNodeId}
                onToggle={onToggle}
                onOpen={onOpen}
              />
            ) : null}
          </div>
        );
      })}
      {files.map((item) => {
        const selected = item.node.id === selectedNodeId;
        return (
          <div
            key={item.resource.id}
            className={cn(
              "flex min-h-8 items-center rounded-md pr-0.5",
              selected
                ? "bg-brand-50 font-medium text-brand-700"
                : "text-secondary-foreground hover:bg-accent hover:text-foreground",
            )}
            style={depth === 0 ? undefined : { marginInlineStart: depth * 18 }}
          >
            <span className="size-7 shrink-0" aria-hidden="true" />
            <button
              type="button"
              className="flex min-h-8 min-w-0 flex-1 items-center gap-2 px-1 text-left text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
              aria-current={selected ? "true" : undefined}
              onClick={() => onOpen(item.node.id)}
            >
              <HtmlViewIcon className="size-4 shrink-0" />
              <span className="truncate">{appTitle(item.node.name)}</span>
            </button>
          </div>
        );
      })}
    </>
  );
}

function TreeToggle({
  expanded,
  name,
  onClick,
}: {
  readonly expanded: boolean;
  readonly name: string;
  readonly onClick: () => void;
}) {
  const { t } = useI18n();
  return (
    <button
      type="button"
      className="grid size-7 shrink-0 place-items-center rounded-md text-muted-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
      aria-expanded={expanded}
      aria-label={t(expanded ? "collapseNode" : "expandNode", { name })}
      onClick={onClick}
    >
      <ChevronRightIcon
        className={cn(
          "size-3.5 transition-transform motion-reduce:transition-none",
          expanded && "rotate-90",
        )}
      />
    </button>
  );
}

function toggleExpanded(
  id: string,
  setExpanded: (update: (current: ReadonlySet<string>) => ReadonlySet<string>) => void,
) {
  setExpanded((current) => {
    const next = new Set(current);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    return next;
  });
}

function readAppsSearch(search: unknown) {
  if (typeof search !== "object" || search === null) return {};
  const value = search as { node?: unknown };
  return {
    ...(typeof value.node === "string" && value.node ? { node: value.node } : {}),
  };
}

function useStoredExpanded(key: string, initial: boolean) {
  const [expanded, setExpanded] = useState(() => {
    try {
      const stored = window.localStorage.getItem(key);
      return stored === null ? initial : stored === "true";
    } catch {
      return initial;
    }
  });
  const update = useCallback(
    (value: boolean) => {
      setExpanded(value);
      try {
        window.localStorage.setItem(key, String(value));
      } catch {
        // Expansion persistence is optional; the in-memory state remains authoritative.
      }
    },
    [key],
  );
  return [expanded, update] as const;
}
