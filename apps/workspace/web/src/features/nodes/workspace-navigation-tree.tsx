import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import {
  ChevronRight,
  ListTree,
  Plus,
  Users,
} from "lucide-react";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type DragEvent,
  type ReactNode,
} from "react";
import type { components } from "../../../../generated/http/schema.js";
import { api } from "../../shared/api/client";
import { apiError } from "../../shared/api/errors";
import { useI18n } from "../../shared/i18n";
import { Button, Spinner, toast, Tooltip } from "../../shared/ui";
import { cn } from "../../shared/utils/cn";
import { CreateNodeDropdown } from "./create-node-dropdown";
import { NodeActionsMenu } from "./node-actions-menu";
import { NodeIcon } from "./node-icon";
import {
  nodeChildrenQueryOptions,
  spaceNodesQueryOptions,
} from "./nodes.queries";
import {
  canDropTreeNode,
  treeDropDestinationKey,
  type TreeDragItem,
  type TreeDropDestination,
} from "./workspace-tree-dnd";

type Space = components["schemas"]["SpaceView"];
type Node = components["schemas"]["NodeSummary"];

interface TreeDragAndDrop {
  readonly draggedNode: TreeDragItem | null;
  readonly activeDestinationKey: string | null;
  readonly startDragging: (event: DragEvent<HTMLElement>, node: Node) => void;
  readonly stopDragging: () => void;
  readonly dragOver: (
    event: DragEvent<HTMLElement>,
    destination: TreeDropDestination
  ) => void;
  readonly dragLeave: (
    event: DragEvent<HTMLElement>,
    destination: TreeDropDestination
  ) => void;
  readonly drop: (
    event: DragEvent<HTMLElement>,
    destination: TreeDropDestination,
    onMoved?: () => void
  ) => void;
}

const TreeDragAndDropContext = createContext<TreeDragAndDrop | null>(null);

export function WorkspaceNavigationTree(props: {
  readonly personalSpace?: Space | undefined;
  readonly teamSpaces: readonly Space[];
  readonly selectedSpaceId?: string | undefined;
  readonly selectedNodeId?: string | undefined;
  readonly selectedNodePath?: readonly string[] | undefined;
  readonly storageScope: string;
  readonly onCreateTeamSpace: () => void;
}) {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const draggedNodeRef = useRef<TreeDragItem | null>(null);
  const [draggedNode, setDraggedNode] = useState<TreeDragItem | null>(null);
  const [activeDestinationKey, setActiveDestinationKey] = useState<
    string | null
  >(null);
  const moveNode = useMutation({
    mutationFn: async (input: {
      readonly nodeId: string;
      readonly parentNodeId: string | null;
    }) => {
      const { error } = await api.PATCH("/api/nodes/{nodeId}", {
        params: { path: { nodeId: input.nodeId } },
        body: { parentNodeId: input.parentNodeId },
      });
      if (error) throw apiError(error);
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["nodes"] }),
        queryClient.invalidateQueries({ queryKey: ["recent-resources"] }),
        queryClient.invalidateQueries({ queryKey: ["owned-by-me"] }),
        queryClient.invalidateQueries({ queryKey: ["shared-with-me"] }),
      ]);
      toast.success(t("itemMoved"));
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : t("moveFailed"));
    },
  });
  const dragAndDrop: TreeDragAndDrop = {
    draggedNode,
    activeDestinationKey,
    startDragging(event, node) {
      if (!node.capabilities.move || moveNode.isPending) {
        event.preventDefault();
        return;
      }
      event.stopPropagation();
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData("text/plain", node.name);
      const item = {
        nodeId: node.id,
        spaceId: node.spaceId,
        parentNodeId: node.parentNodeId,
      };
      draggedNodeRef.current = item;
      setDraggedNode(item);
    },
    stopDragging() {
      draggedNodeRef.current = null;
      setDraggedNode(null);
      setActiveDestinationKey(null);
    },
    dragOver(event, destination) {
      event.stopPropagation();
      if (!canDropTreeNode(draggedNodeRef.current, destination)) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = "move";
      setActiveDestinationKey(treeDropDestinationKey(destination));
    },
    dragLeave(event, destination) {
      event.stopPropagation();
      if (
        event.relatedTarget instanceof HTMLElement &&
        event.currentTarget.contains(event.relatedTarget)
      ) {
        return;
      }
      const key = treeDropDestinationKey(destination);
      setActiveDestinationKey((current) => (current === key ? null : current));
    },
    drop(event, destination, onMoved) {
      event.stopPropagation();
      const item = draggedNodeRef.current;
      if (!canDropTreeNode(item, destination) || !item) return;
      event.preventDefault();
      const nodeId = item.nodeId;
      draggedNodeRef.current = null;
      setDraggedNode(null);
      setActiveDestinationKey(null);
      const input = { nodeId, parentNodeId: destination.parentNodeId };
      if (onMoved) {
        moveNode.mutate(input, { onSuccess: onMoved });
      } else {
        moveNode.mutate(input);
      }
    },
  };
  const personalSelected = props.personalSpace?.id === props.selectedSpaceId;
  const teamSelected = props.teamSpaces.some(
    (space) => space.id === props.selectedSpaceId
  );
  const [personalExpanded, setPersonalExpanded] = useStoredExpanded(
    `workspace-tree:${props.storageScope}:personal`,
    personalSelected || props.teamSpaces.length === 0
  );
  const [teamsExpanded, setTeamsExpanded] = useStoredExpanded(
    `workspace-tree:${props.storageScope}:teams`,
    teamSelected || props.teamSpaces.length > 0
  );

  useEffect(() => {
    if (personalSelected) setPersonalExpanded(true);
  }, [personalSelected, setPersonalExpanded]);

  useEffect(() => {
    if (teamSelected) setTeamsExpanded(true);
  }, [teamSelected, setTeamsExpanded]);

  return (
    <TreeDragAndDropContext.Provider value={dragAndDrop}>
      <div className="mt-4 grid gap-1">
        {props.personalSpace ? (
          <NavigationSection
            label={t("personalSpace")}
            expanded={personalExpanded}
            onExpandedChange={setPersonalExpanded}
            rootDropDestination={{
              spaceId: props.personalSpace.id,
              parentNodeId: null,
              ancestorNodeIds: [],
              canCreateChildren: props.personalSpace.capabilities.createAtRoot,
            }}
            actions={
              <>
                {props.personalSpace.capabilities.createAtRoot ? (
                  <CreateNodeDropdown
                    spaceId={props.personalSpace.id}
                    placement="tree"
                    onCreated={() => setPersonalExpanded(true)}
                  />
                ) : null}
                <Tooltip content={t("openSpace")}>
                  <Link
                    to="/spaces/$spaceId"
                    params={{ spaceId: props.personalSpace.id }}
                    aria-label={t("openSpace")}
                    className="grid size-7 place-items-center rounded-md text-secondary-foreground outline-none transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:ring-2 focus-visible:ring-ring/40 [&_svg]:size-3.5"
                  >
                    <ListTree />
                  </Link>
                </Tooltip>
              </>
            }
          >
            <SpaceNodeList
              space={props.personalSpace}
              depth={0}
              selectedNodeId={props.selectedNodeId}
              selectedNodePath={props.selectedNodePath}
            />
          </NavigationSection>
        ) : null}

        <NavigationSection
          label={t("teamSpace")}
          expanded={teamsExpanded}
          onExpandedChange={setTeamsExpanded}
          actions={
            <Tooltip content={t("createTeamSpace")}>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={t("createTeamSpace")}
                onClick={props.onCreateTeamSpace}
              >
                <Plus />
              </Button>
            </Tooltip>
          }
        >
          <div className="grid gap-0.5">
            {props.teamSpaces.map((space) => (
              <TeamSpaceTree
                key={space.id}
                space={space}
                storageScope={props.storageScope}
                active={space.id === props.selectedSpaceId}
                selectedNodeId={props.selectedNodeId}
                selectedNodePath={props.selectedNodePath}
              />
            ))}
          </div>
        </NavigationSection>
      </div>
    </TreeDragAndDropContext.Provider>
  );
}

function NavigationSection(props: {
  readonly label: string;
  readonly expanded: boolean;
  readonly onExpandedChange: (expanded: boolean) => void;
  readonly rootDropDestination?: TreeDropDestination | undefined;
  readonly actions: ReactNode;
  readonly children: ReactNode;
}) {
  const { t } = useI18n();
  const dragAndDrop = useTreeDragAndDrop();
  const dropActive =
    props.rootDropDestination &&
    dragAndDrop.activeDestinationKey ===
      treeDropDestinationKey(props.rootDropDestination);
  const toggleLabel = props.expanded
    ? t("collapseSection", { name: props.label })
    : t("expandSection", { name: props.label });

  return (
    <section aria-label={props.label}>
      <div
        className={cn(
          "flex min-h-8 items-center rounded-md pr-0.5 pl-1.5 transition-colors",
          dropActive && "bg-brand-50 ring-2 ring-brand-500 ring-inset"
        )}
        onDragOver={
          props.rootDropDestination
            ? (event) => dragAndDrop.dragOver(event, props.rootDropDestination!)
            : undefined
        }
        onDragLeave={
          props.rootDropDestination
            ? (event) => dragAndDrop.dragLeave(event, props.rootDropDestination!)
            : undefined
        }
        onDrop={
          props.rootDropDestination
            ? (event) =>
                dragAndDrop.drop(event, props.rootDropDestination!, () =>
                  props.onExpandedChange(true)
                )
            : undefined
        }
      >
        <button
          type="button"
          aria-expanded={props.expanded}
          aria-label={toggleLabel}
          className="flex h-8 min-w-0 flex-1 cursor-pointer items-center gap-1 rounded-md text-left text-xs font-semibold text-subtle-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/40"
          onClick={() => props.onExpandedChange(!props.expanded)}
        >
          <ChevronRight
            className={cn(
              "size-3.5 shrink-0 transition-transform",
              props.expanded && "rotate-90"
            )}
          />
          <span className="truncate">{props.label}</span>
        </button>
        <span className="flex shrink-0 items-center">{props.actions}</span>
      </div>
      {props.expanded ? props.children : null}
    </section>
  );
}

function TeamSpaceTree(props: {
  readonly space: Space;
  readonly active: boolean;
  readonly storageScope: string;
  readonly selectedNodeId?: string | undefined;
  readonly selectedNodePath?: readonly string[] | undefined;
}) {
  const { t } = useI18n();
  const dragAndDrop = useTreeDragAndDrop();
  const [expanded, setExpanded] = useStoredExpanded(
    `workspace-tree:${props.storageScope}:space:${props.space.id}`,
    props.active
  );

  useEffect(() => {
    if (props.active) setExpanded(true);
  }, [props.active, setExpanded]);

  const rootDropDestination: TreeDropDestination = {
    spaceId: props.space.id,
    parentNodeId: null,
    ancestorNodeIds: [],
    canCreateChildren: props.space.capabilities.createAtRoot,
  };
  const dropActive =
    dragAndDrop.activeDestinationKey ===
    treeDropDestinationKey(rootDropDestination);

  return (
    <div>
      <div
        className={cn(
          "group flex min-h-8 items-center rounded-md pr-0.5 transition-colors",
          dropActive && "bg-brand-50 ring-2 ring-brand-500 ring-inset",
          props.active && !props.selectedNodeId
            ? "bg-brand-50 text-brand-700"
            : "text-secondary-foreground hover:bg-accent hover:text-accent-foreground"
        )}
        onDragOver={(event) => dragAndDrop.dragOver(event, rootDropDestination)}
        onDragLeave={(event) =>
          dragAndDrop.dragLeave(event, rootDropDestination)
        }
        onDrop={(event) =>
          dragAndDrop.drop(event, rootDropDestination, () => setExpanded(true))
        }
      >
        <TreeToggle
          expanded={expanded}
          label={
            expanded
              ? t("collapseSection", { name: props.space.name })
              : t("expandSection", { name: props.space.name })
          }
          onClick={() => setExpanded(!expanded)}
        />
        <Link
          to="/spaces/$spaceId"
          params={{ spaceId: props.space.id }}
          className="flex h-8 min-w-0 flex-1 items-center gap-2 rounded-md px-1 text-sm font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
        >
          <Users className="size-4 shrink-0 text-muted-foreground" />
          <span className="truncate">{props.space.name}</span>
        </Link>
        <span className="flex shrink-0 items-center opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
          {props.space.capabilities.createAtRoot ? (
            <CreateNodeDropdown
              spaceId={props.space.id}
              placement="tree"
              onCreated={() => setExpanded(true)}
            />
          ) : null}
        </span>
      </div>
      {expanded ? (
        <SpaceNodeList
          space={props.space}
          depth={1}
          selectedNodeId={props.selectedNodeId}
          selectedNodePath={props.selectedNodePath}
        />
      ) : null}
    </div>
  );
}

function SpaceNodeList(props: {
  readonly space: Space;
  readonly depth: number;
  readonly selectedNodeId?: string | undefined;
  readonly selectedNodePath?: readonly string[] | undefined;
}) {
  const { t } = useI18n();
  const query = useQuery({
    ...spaceNodesQueryOptions(props.space.id),
    enabled: props.space.capabilities.browseRoot,
  });

  if (!props.space.capabilities.browseRoot) return null;

  if (query.isPending) {
    return (
      <div
        className="flex h-8 items-center text-muted-foreground"
        style={{ paddingLeft: `${10 + props.depth * 18}px` }}
      >
        <Spinner className="size-3.5" label={t("loadingNodes")} />
      </div>
    );
  }
  if (query.error) {
    return (
      <p
        className="m-0 py-1.5 text-xs text-destructive"
        style={{ paddingLeft: `${10 + props.depth * 18}px` }}
      >
        {t("nodesLoadFailed")}
      </p>
    );
  }
  if (query.data.nodes.length === 0) {
    return (
      <p
        className="m-0 py-1.5 text-xs text-subtle-foreground"
        style={{ paddingLeft: `${10 + props.depth * 18}px` }}
      >
        {t("spaceEmpty")}
      </p>
    );
  }

  return (
    <div className="grid min-w-0 gap-0.5">
      {query.data.nodes.map((node) => (
        <NavigationNode
          key={node.id}
          node={node}
          depth={props.depth}
          selectedNodeId={props.selectedNodeId}
          selectedNodePath={props.selectedNodePath}
          ancestorNodeIds={[]}
        />
      ))}
    </div>
  );
}

function NavigationNode(props: {
  readonly node: Node;
  readonly depth: number;
  readonly selectedNodeId?: string | undefined;
  readonly selectedNodePath?: readonly string[] | undefined;
  readonly ancestorNodeIds: readonly string[];
}) {
  const { t } = useI18n();
  const dragAndDrop = useTreeDragAndDrop();
  const onSelectedPath =
    props.selectedNodePath?.includes(props.node.id) ?? false;
  const [expanded, setExpanded] = useState(
    onSelectedPath && props.node.hasChildren
  );
  const canBrowseChildren = props.node.capabilities.browseChildren;
  const canExpand = canBrowseChildren && props.node.hasChildren;
  const children = useQuery({
    ...nodeChildrenQueryOptions(props.node.id),
    enabled: expanded && canBrowseChildren,
  });
  const dropDestination: TreeDropDestination = {
    spaceId: props.node.spaceId,
    parentNodeId: props.node.id,
    ancestorNodeIds: props.ancestorNodeIds,
    canCreateChildren: props.node.capabilities.createChildren,
  };
  const dropActive =
    dragAndDrop.activeDestinationKey ===
    treeDropDestinationKey(dropDestination);

  useEffect(() => {
    if (onSelectedPath && props.node.hasChildren) setExpanded(true);
  }, [onSelectedPath, props.node.hasChildren]);

  return (
    <div className="min-w-0">
      <NodeActionsMenu node={props.node}>
        {(nodeActions) => (
          <div
            className={cn(
              "group flex min-h-8 w-full min-w-0 items-center overflow-hidden rounded-md pr-0.5 transition-colors",
              "data-popup-open:bg-accent data-popup-open:text-accent-foreground",
              props.node.capabilities.move &&
                "cursor-grab active:cursor-grabbing",
              dragAndDrop.draggedNode?.nodeId === props.node.id && "opacity-50",
              dropActive && "bg-brand-50 ring-2 ring-brand-500 ring-inset",
              props.node.id === props.selectedNodeId
                ? "bg-brand-50 font-medium text-brand-700"
                : "text-secondary-foreground hover:bg-accent hover:text-accent-foreground"
            )}
            style={{ paddingLeft: `${props.depth * 18}px` }}
            draggable={props.node.capabilities.move}
            onDragStart={(event) => dragAndDrop.startDragging(event, props.node)}
            onDragEnd={dragAndDrop.stopDragging}
            onDragOver={(event) => dragAndDrop.dragOver(event, dropDestination)}
            onDragLeave={(event) =>
              dragAndDrop.dragLeave(event, dropDestination)
            }
            onDrop={(event) =>
              dragAndDrop.drop(event, dropDestination, () => setExpanded(true))
            }
          >
            {canExpand ? (
              <TreeToggle
                expanded={expanded}
                label={
                  expanded
                    ? t("collapseNode", { name: props.node.name })
                    : t("expandNode", { name: props.node.name })
                }
                onClick={() => setExpanded(!expanded)}
              />
            ) : (
              <span className="w-7 shrink-0" aria-hidden="true" />
            )}
            <Link
              to="/nodes/$nodeId"
              params={{ nodeId: props.node.id }}
              title={props.node.name}
              draggable={false}
              className="flex h-8 min-w-0 flex-1 items-center gap-2 overflow-hidden rounded-md px-1 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
            >
              <NodeIcon
                kind={props.node.resource ? "resource" : "group"}
                resourceKind={props.node.resource?.kind}
                unitType={
                  props.node.resource?.kind === "univer"
                    ? props.node.resource.unitType
                    : null
                }
                mediaType={
                  props.node.resource?.kind === "blob"
                    ? props.node.resource.mediaType
                    : null
                }
              />
              <span className="min-w-0 truncate">{props.node.name}</span>
            </Link>
            <span
              className={cn(
                "flex shrink-0 items-center transition-opacity",
                props.node.id === props.selectedNodeId
                  ? "opacity-100"
                  : "opacity-0 group-hover:opacity-100 group-focus-within:opacity-100"
              )}
            >
              {props.node.capabilities.createChildren ? (
                <CreateNodeDropdown
                  spaceId={props.node.spaceId}
                  parentNodeId={props.node.id}
                  placement="tree"
                  onCreated={() => setExpanded(true)}
                />
              ) : null}
              {nodeActions}
            </span>
          </div>
        )}
      </NodeActionsMenu>
      {expanded && canBrowseChildren ? (
        children.isPending ? (
          <div
            className="flex h-8 items-center text-muted-foreground"
            style={{ paddingLeft: `${38 + props.depth * 18}px` }}
          >
            <Spinner className="size-3.5" label={t("loadingNodes")} />
          </div>
        ) : children.error ? (
          <p
            className="m-0 py-1.5 text-xs text-destructive"
            style={{ paddingLeft: `${38 + props.depth * 18}px` }}
          >
            {t("nodesLoadFailed")}
          </p>
        ) : (
          <div className="grid min-w-0 gap-0.5">
            {children.data.nodes.map((child) => (
              <NavigationNode
                key={child.id}
                node={child}
                depth={props.depth + 1}
                selectedNodeId={props.selectedNodeId}
                selectedNodePath={props.selectedNodePath}
                ancestorNodeIds={[...props.ancestorNodeIds, props.node.id]}
              />
            ))}
          </div>
        )
      ) : null}
    </div>
  );
}

function useTreeDragAndDrop(): TreeDragAndDrop {
  const value = useContext(TreeDragAndDropContext);
  if (!value) {
    throw new Error("Tree drag-and-drop must be used within its provider.");
  }
  return value;
}

function TreeToggle(props: {
  readonly expanded: boolean;
  readonly label: string;
  readonly onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-expanded={props.expanded}
      aria-label={props.label}
      className="grid size-7 shrink-0 cursor-pointer place-items-center rounded-md text-subtle-foreground outline-none hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/40"
      onClick={props.onClick}
    >
      <ChevronRight
        className={cn(
          "size-3.5 transition-transform",
          props.expanded && "rotate-90"
        )}
      />
    </button>
  );
}

function useStoredExpanded(
  key: string,
  defaultValue: boolean
): [boolean, (expanded: boolean) => void] {
  const [expanded, setExpanded] = useState(() => {
    try {
      const stored = window.localStorage.getItem(key);
      return stored === null ? defaultValue : stored === "true";
    } catch {
      return defaultValue;
    }
  });

  const update = useCallback((next: boolean) => {
    setExpanded(next);
    try {
      window.localStorage.setItem(key, String(next));
    } catch {
      // Persistence is optional when storage is unavailable.
    }
  }, [key]);

  return [expanded, update];
}
