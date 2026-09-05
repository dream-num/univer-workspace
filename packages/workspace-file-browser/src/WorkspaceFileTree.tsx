import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent,
  type ReactElement,
  type ReactNode,
} from "react";
import { ChevronRightIcon, UsersIcon } from "@univerjs/univer-workspace-ui";
import {
  canDropWorkspaceFileNode,
  dragItemOf,
  groupWorkspaceFileSpaces,
  workspaceFileDropKey,
  type WorkspaceFileDragItem,
  type WorkspaceFileDropDestination,
} from "./model.js";
import type {
  WorkspaceFileChildrenRequest,
  WorkspaceFileLocale,
  WorkspaceFileNode,
  WorkspaceFileSpace,
  WorkspaceFileTreeControls,
  WorkspaceFileTreeProps,
} from "./types.js";
import { NodeIcon } from "./NodeIcon.js";
import css from "./WorkspaceFileTree.module.scss";

type BranchState =
  | { readonly status: "loading" }
  | { readonly status: "ready"; readonly nodes: readonly WorkspaceFileNode[] }
  | { readonly status: "error" };

interface DragState {
  readonly dragged: WorkspaceFileDragItem | null;
  readonly activeDestination: string | null;
  readonly start: (event: DragEvent<HTMLElement>, node: WorkspaceFileNode) => void;
  readonly stop: () => void;
  readonly over: (event: DragEvent<HTMLElement>, destination: WorkspaceFileDropDestination) => void;
  readonly leave: (
    event: DragEvent<HTMLElement>,
    destination: WorkspaceFileDropDestination,
  ) => void;
  readonly drop: (
    event: DragEvent<HTMLElement>,
    destination: WorkspaceFileDropDestination,
    afterMove?: () => void,
  ) => void;
}

const DragContext = createContext<DragState | null>(null);

const labels = {
  "zh-CN": {
    personal: "个人空间",
    teams: "团队空间",
    empty: "暂无文件",
    loadFailed: "文件加载失败",
    collapse: "收起",
    expand: "展开",
  },
  "en-US": {
    personal: "Personal Space",
    teams: "Team Spaces",
    empty: "No files",
    loadFailed: "Files could not be loaded",
    collapse: "Collapse",
    expand: "Expand",
  },
} as const;

export function WorkspaceFileTree(props: WorkspaceFileTreeProps): ReactElement {
  const grouped = useMemo(() => groupWorkspaceFileSpaces(props.spaces), [props.spaces]);
  const copy = labels[props.locale];
  const [refreshEpoch, setRefreshEpoch] = useState(0);
  const [dragged, setDragged] = useState<WorkspaceFileDragItem | null>(null);
  const draggedRef = useRef<WorkspaceFileDragItem | null>(null);
  const [activeDestination, setActiveDestination] = useState<string | null>(null);
  const refresh = useCallback(() => setRefreshEpoch((value) => value + 1), []);
  const dragState = useMemo<DragState>(
    () => ({
      dragged,
      activeDestination,
      start(event, node) {
        if (!node.capabilities.move) {
          event.preventDefault();
          return;
        }
        event.stopPropagation();
        event.dataTransfer.effectAllowed = "move";
        event.dataTransfer.setData("text/plain", node.name);
        const item = dragItemOf(node);
        draggedRef.current = item;
        setDragged(item);
      },
      stop() {
        draggedRef.current = null;
        setDragged(null);
        setActiveDestination(null);
      },
      over(event, destination) {
        event.stopPropagation();
        if (!canDropWorkspaceFileNode(draggedRef.current, destination)) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = "move";
        setActiveDestination(workspaceFileDropKey(destination));
      },
      leave(event, destination) {
        event.stopPropagation();
        if (
          event.relatedTarget instanceof HTMLElement &&
          event.currentTarget.contains(event.relatedTarget)
        ) {
          return;
        }
        const key = workspaceFileDropKey(destination);
        setActiveDestination((current) => (current === key ? null : current));
      },
      drop(event, destination, afterMove) {
        event.stopPropagation();
        const item = draggedRef.current;
        if (!canDropWorkspaceFileNode(item, destination) || item === null) return;
        event.preventDefault();
        draggedRef.current = null;
        setDragged(null);
        setActiveDestination(null);
        void props.dataSource
          .moveNode({ nodeId: item.nodeId, parentNodeId: destination.parentNodeId })
          .then(() => {
            refresh();
            afterMove?.();
          })
          .catch(() => {
            // The consumer owns user-facing mutation errors.
          });
      },
    }),
    [activeDestination, dragged, props.dataSource, refresh],
  );

  return (
    <DragContext.Provider value={dragState}>
      <div className={css.tree} data-surface="workspace-file-tree">
        {grouped.personal !== undefined && (
          <PersonalSection
            space={grouped.personal}
            props={props}
            refreshEpoch={refreshEpoch}
            refresh={refresh}
            label={copy.personal}
          />
        )}
        <TeamSection
          spaces={grouped.teams}
          props={props}
          refreshEpoch={refreshEpoch}
          refresh={refresh}
          label={copy.teams}
        />
      </div>
    </DragContext.Provider>
  );
}

function PersonalSection({
  space,
  props,
  refreshEpoch,
  refresh,
  label,
}: {
  readonly space: WorkspaceFileSpace;
  readonly props: WorkspaceFileTreeProps;
  readonly refreshEpoch: number;
  readonly refresh: () => void;
  readonly label: string;
}): ReactElement {
  const [expanded, setExpanded] = useStoredExpanded(
    `workspace-file-tree:${props.storageScope}:personal`,
    props.selectedSpaceId === space.id ||
      props.spaces.filter((item) => item.type === "team").length === 0,
  );
  useEffect(() => {
    if (props.selectedSpaceId === space.id) setExpanded(true);
  }, [props.selectedSpaceId, setExpanded, space.id]);
  const destination = rootDestination(space);
  return (
    <NavigationSection
      label={label}
      expanded={expanded}
      setExpanded={setExpanded}
      destination={destination}
      actions={props.renderSpaceActions?.(space, {
        refresh,
        expand: () => setExpanded(true),
      })}
    >
      <NodeBranch
        space={space}
        parentNodeId={null}
        depth={0}
        ancestorNodeIds={[]}
        props={props}
        refreshEpoch={refreshEpoch}
        refresh={refresh}
      />
    </NavigationSection>
  );
}

function TeamSection({
  spaces,
  props,
  refreshEpoch,
  refresh,
  label,
}: {
  readonly spaces: readonly WorkspaceFileSpace[];
  readonly props: WorkspaceFileTreeProps;
  readonly refreshEpoch: number;
  readonly refresh: () => void;
  readonly label: string;
}): ReactElement {
  const selected = spaces.some((space) => space.id === props.selectedSpaceId);
  const [expanded, setExpanded] = useStoredExpanded(
    `workspace-file-tree:${props.storageScope}:teams`,
    selected || spaces.length > 0,
  );
  useEffect(() => {
    if (selected) setExpanded(true);
  }, [selected, setExpanded]);
  return (
    <NavigationSection
      label={label}
      expanded={expanded}
      setExpanded={setExpanded}
      actions={props.renderTeamActions?.()}
    >
      <div className={css.spaceList}>
        {spaces.map((space) => (
          <TeamSpace
            key={space.id}
            space={space}
            props={props}
            refreshEpoch={refreshEpoch}
            refresh={refresh}
          />
        ))}
      </div>
    </NavigationSection>
  );
}

function TeamSpace({
  space,
  props,
  refreshEpoch,
  refresh,
}: {
  readonly space: WorkspaceFileSpace;
  readonly props: WorkspaceFileTreeProps;
  readonly refreshEpoch: number;
  readonly refresh: () => void;
}): ReactElement {
  const active = props.selectedSpaceId === space.id;
  const copy = labels[props.locale];
  const [expanded, setExpanded] = useStoredExpanded(
    `workspace-file-tree:${props.storageScope}:space:${space.id}`,
    active,
  );
  useEffect(() => {
    if (active) setExpanded(true);
  }, [active, setExpanded]);
  const destination = rootDestination(space);
  const drag = useDragState();
  const dropActive = drag.activeDestination === workspaceFileDropKey(destination);
  return (
    <div className={css.space}>
      <div
        className={`${css.spaceRow} ${active && props.selectedNodeId === undefined ? css.selected : ""} ${dropActive ? css.dropActive : ""}`}
        onDragOver={(event) => drag.over(event, destination)}
        onDragLeave={(event) => drag.leave(event, destination)}
        onDrop={(event) => drag.drop(event, destination, () => setExpanded(true))}
      >
        <TreeToggle
          expanded={expanded}
          name={space.name}
          actionLabel={expanded ? copy.collapse : copy.expand}
          onClick={() => setExpanded(!expanded)}
        />
        <button type="button" className={css.itemButton} onClick={() => props.onOpenSpace(space)}>
          <UsersIcon className={css.spaceIcon} />
          <span>{space.name}</span>
        </button>
        <span className={css.actions}>
          {props.renderSpaceActions?.(space, {
            refresh,
            expand: () => setExpanded(true),
          })}
        </span>
      </div>
      {expanded && (
        <NodeBranch
          space={space}
          parentNodeId={null}
          depth={1}
          ancestorNodeIds={[]}
          props={props}
          refreshEpoch={refreshEpoch}
          refresh={refresh}
        />
      )}
    </div>
  );
}

function NavigationSection({
  label,
  expanded,
  setExpanded,
  destination,
  actions,
  children,
}: {
  readonly label: string;
  readonly expanded: boolean;
  readonly setExpanded: (value: boolean) => void;
  readonly destination?: WorkspaceFileDropDestination;
  readonly actions?: ReactNode;
  readonly children: ReactNode;
}): ReactElement {
  const drag = useDragState();
  const dropActive =
    destination !== undefined && drag.activeDestination === workspaceFileDropKey(destination);
  return (
    <section className={css.section} aria-label={label}>
      <div
        className={`${css.sectionRow} ${dropActive ? css.dropActive : ""}`}
        onDragOver={
          destination === undefined ? undefined : (event) => drag.over(event, destination)
        }
        onDragLeave={
          destination === undefined ? undefined : (event) => drag.leave(event, destination)
        }
        onDrop={
          destination === undefined
            ? undefined
            : (event) => drag.drop(event, destination, () => setExpanded(true))
        }
      >
        <button
          type="button"
          className={css.sectionButton}
          aria-expanded={expanded}
          onClick={() => setExpanded(!expanded)}
        >
          <ChevronRightIcon className={`${css.chevron} ${expanded ? css.expanded : ""}`} />
          <span>{label}</span>
        </button>
        <span className={css.actions}>{actions}</span>
      </div>
      {expanded && children}
    </section>
  );
}

function NodeBranch({
  space,
  parentNodeId,
  depth,
  ancestorNodeIds,
  props,
  refreshEpoch,
  refresh,
}: {
  readonly space: WorkspaceFileSpace;
  readonly parentNodeId: string | null;
  readonly depth: number;
  readonly ancestorNodeIds: readonly string[];
  readonly props: WorkspaceFileTreeProps;
  readonly refreshEpoch: number;
  readonly refresh: () => void;
}): ReactElement | null {
  const state = useBranch(props.dataSource.loadChildren, space.id, parentNodeId, refreshEpoch);
  const copy = labels[props.locale];
  const branchIndent = depth === 0 ? "" : css.branchIndented;
  if (!space.capabilities.browseRoot && parentNodeId === null) return null;
  if (state.status === "loading") {
    return (
      <div className={`${css.status} ${branchIndent}`}>
        <span className={css.spinner} aria-hidden="true" />
      </div>
    );
  }
  if (state.status === "error") {
    return <p className={`${css.error} ${branchIndent}`}>{copy.loadFailed}</p>;
  }
  if (state.nodes.length === 0) {
    return <p className={`${css.empty} ${branchIndent}`}>{copy.empty}</p>;
  }
  return (
    <div className={`${css.nodeList} ${branchIndent}`}>
      {state.nodes.map((node) => (
        <NavigationNode
          key={node.id}
          node={node}
          space={space}
          depth={depth}
          ancestorNodeIds={ancestorNodeIds}
          props={props}
          refreshEpoch={refreshEpoch}
          refresh={refresh}
        />
      ))}
    </div>
  );
}

function NavigationNode({
  node,
  space,
  depth,
  ancestorNodeIds,
  props,
  refreshEpoch,
  refresh,
}: {
  readonly node: WorkspaceFileNode;
  readonly space: WorkspaceFileSpace;
  readonly depth: number;
  readonly ancestorNodeIds: readonly string[];
  readonly props: WorkspaceFileTreeProps;
  readonly refreshEpoch: number;
  readonly refresh: () => void;
}): ReactElement {
  const copy = labels[props.locale];
  const selectedPath = props.selectedNodePath?.includes(node.id) ?? false;
  const canExpand = node.hasChildren && node.capabilities.browseChildren;
  const [expanded, setExpanded] = useState(selectedPath && canExpand);
  const drag = useDragState();
  useEffect(() => {
    if (selectedPath && canExpand) setExpanded(true);
  }, [canExpand, selectedPath]);
  const destination: WorkspaceFileDropDestination = {
    spaceId: node.spaceId,
    parentNodeId: node.id,
    ancestorNodeIds,
    canCreateChildren: node.capabilities.createChildren,
  };
  const dropActive = drag.activeDestination === workspaceFileDropKey(destination);
  const controls: WorkspaceFileTreeControls = {
    refresh,
    expand: () => setExpanded(true),
  };
  const renderRow = (actions?: ReactNode): ReactElement => (
    <div
      className={`${css.nodeRow} ${node.id === props.selectedNodeId ? css.selected : ""} ${drag.dragged?.nodeId === node.id ? css.dragging : ""} ${dropActive ? css.dropActive : ""}`}
      draggable={node.capabilities.move}
      onDragStart={(event) => drag.start(event, node)}
      onDragEnd={drag.stop}
      onDragOver={(event) => drag.over(event, destination)}
      onDragLeave={(event) => drag.leave(event, destination)}
      onDrop={(event) => drag.drop(event, destination, () => setExpanded(true))}
    >
      {canExpand ? (
        <TreeToggle
          expanded={expanded}
          name={node.name}
          actionLabel={expanded ? copy.collapse : copy.expand}
          onClick={() => setExpanded(!expanded)}
        />
      ) : (
        <span className={css.toggleSpacer} aria-hidden="true" />
      )}
      <button type="button" className={css.itemButton} onClick={() => props.onOpenNode(node)}>
        <NodeIcon resource={node.resource} />
        <span title={node.name}>{node.name}</span>
      </button>
      <span className={css.actions}>{actions}</span>
    </div>
  );
  return (
    <div className={css.node}>
      {props.decorateNodeRow?.(node, controls, renderRow) ?? renderRow()}
      {expanded && canExpand && (
        <NodeBranch
          space={space}
          parentNodeId={node.id}
          depth={depth + 1}
          ancestorNodeIds={[...ancestorNodeIds, node.id]}
          props={props}
          refreshEpoch={refreshEpoch}
          refresh={refresh}
        />
      )}
    </div>
  );
}

function TreeToggle({
  expanded,
  name,
  actionLabel,
  onClick,
}: {
  readonly expanded: boolean;
  readonly name: string;
  readonly actionLabel: string;
  readonly onClick: () => void;
}): ReactElement {
  return (
    <button
      type="button"
      className={css.treeToggle}
      aria-label={`${actionLabel} ${name}`}
      aria-expanded={expanded}
      onClick={onClick}
    >
      <ChevronRightIcon className={`${css.chevron} ${expanded ? css.expanded : ""}`} />
    </button>
  );
}

function rootDestination(space: WorkspaceFileSpace): WorkspaceFileDropDestination {
  return {
    spaceId: space.id,
    parentNodeId: null,
    ancestorNodeIds: [],
    canCreateChildren: space.capabilities.createAtRoot,
  };
}

function useBranch(
  loadChildren: (input: WorkspaceFileChildrenRequest) => Promise<readonly WorkspaceFileNode[]>,
  spaceId: string,
  parentNodeId: string | null,
  refreshEpoch: number,
): BranchState {
  const [state, setState] = useState<BranchState>({ status: "loading" });
  useEffect(() => {
    const abort = new AbortController();
    setState((current) => (current.status === "ready" ? current : { status: "loading" }));
    void loadChildren({ spaceId, parentNodeId, signal: abort.signal }).then(
      (nodes) => {
        if (!abort.signal.aborted) setState({ status: "ready", nodes });
      },
      () => {
        if (!abort.signal.aborted) setState({ status: "error" });
      },
    );
    return () => abort.abort();
  }, [loadChildren, parentNodeId, refreshEpoch, spaceId]);
  return state;
}

function useStoredExpanded(
  key: string,
  initial: boolean,
): readonly [boolean, (value: boolean) => void] {
  const [expanded, setExpanded] = useState(() => {
    if (typeof window === "undefined") return initial;
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

function useDragState(): DragState {
  const value = useContext(DragContext);
  if (value === null) throw new Error("WorkspaceFileTree drag context is unavailable");
  return value;
}
