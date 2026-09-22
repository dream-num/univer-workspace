import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { isHtmlViewFilename } from "@univerjs-labs/html-view";
import { Download, Lock, Maximize, MoreHorizontal, Pencil, Share2 } from "lucide-react";
import { useState } from "react";
import type { IMember } from "@univerjs/protocol";
import type { components } from "../../../../generated/http/schema.js";
import { CollaboratorAvatars } from "../editor";
import { ShareDialog } from "../permissions";
import { htmlViewsQueryKey } from "../views/html-views.queries";
import { api } from "../../shared/api/client";
import { apiError } from "../../shared/api/errors";
import { useI18n } from "../../shared/i18n";
import { useMediaQuery } from "../../shared/resizable-sidebar";
import {
  Button,
  EditableText,
  MenuContent,
  MenuItem,
  MenuRoot,
  MenuTrigger,
  Tooltip,
  buttonVariants,
  toast,
} from "../../shared/ui";
import { cn } from "../../shared/utils/cn";
import { nodeQueryOptions } from "./nodes.queries";
import { resourceOpenQueryOptions } from "../resources";

type Node = components["schemas"]["NodeSummary"];

export function ResourceTitle({
  node,
  resourceId,
  authenticated,
}: {
  readonly node: Node;
  readonly resourceId: string;
  readonly authenticated: boolean;
}) {
  const queryClient = useQueryClient();
  const { t } = useI18n();
  const rename = useMutation({
    mutationFn: async (name: string) => {
      const { data: updated, error } = await api.PATCH("/api/nodes/{nodeId}", {
        params: { path: { nodeId: node.id } },
        body: { name },
      });
      if (error) throw apiError(error);
      return updated;
    },
    onSuccess: async (updated) => {
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: nodeQueryOptions(node.id).queryKey,
        }),
        queryClient.invalidateQueries({
          queryKey: resourceOpenQueryOptions(resourceId).queryKey,
        }),
        queryClient.invalidateQueries({ queryKey: ["nodes"] }),
        queryClient.invalidateQueries({ queryKey: ["recent-resources"] }),
        queryClient.invalidateQueries({ queryKey: ["owned-by-me"] }),
        queryClient.invalidateQueries({ queryKey: ["shared-with-me"] }),
        queryClient.invalidateQueries({ queryKey: htmlViewsQueryKey }),
      ]);
      toast.success(t("resourceRenamed", { name: updated.name }));
    },
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : t("resourceRenameFailed")),
  });
  return (
    <EditableText
      value={node.name}
      canEdit={authenticated && node.capabilities.rename}
      editLabel={t("renameResource")}
      onCommit={(name) => rename.mutate(name)}
    />
  );
}

export function ResourceActions({
  node,
  resource,
  authenticated,
  currentUserId,
  collaborators,
  htmlActionsRef,
}: {
  readonly node: Node;
  readonly resource: components["schemas"]["ResourceOpenView"]["resource"];
  readonly authenticated: boolean;
  readonly currentUserId: string;
  readonly collaborators: readonly IMember[];
  readonly htmlActionsRef: (element: HTMLSpanElement | null) => void;
}) {
  const { t } = useI18n();
  const [shareOpen, setShareOpen] = useState(false);
  const compactViewport = useMediaQuery("(max-width: 720px)");
  const isEditing = authenticated && resource.kind === "univer" && resource.editorMode === "edit";
  const modeLabel = isEditing ? t("editingMode") : t("readOnlyMode");
  return (
    <>
      {resource.kind === "blob" && isHtmlViewFilename(resource.originalFilename) ? (
        <span ref={htmlActionsRef} className="contents" />
      ) : null}
      {resource.kind === "blob" ? (
        <a
          className={cn(buttonVariants({ variant: "secondary", size: "sm" }), "no-underline")}
          href={resource.downloadUrl}
        >
          <Download />
          {t("download")}
        </a>
      ) : (
        <CollaboratorAvatars
          members={collaborators}
          currentUserId={currentUserId}
          maxVisible={compactViewport ? 1 : undefined}
        />
      )}
      {authenticated && node.capabilities.share ? (
        compactViewport ? (
          <Tooltip content={t("shareAction")}>
            <Button
              variant="secondary"
              size="icon-sm"
              aria-label={t("shareAction")}
              onClick={() => setShareOpen(true)}
            >
              <Share2 />
            </Button>
          </Tooltip>
        ) : (
          <Button size="sm" onClick={() => setShareOpen(true)}>
            <Share2 />
            {t("shareAction")}
          </Button>
        )
      ) : null}
      {compactViewport ? (
        <MenuRoot>
          <MenuTrigger
            aria-label={t("moreActions")}
            render={<Button variant="ghost" size="icon-sm" />}
          >
            <MoreHorizontal />
          </MenuTrigger>
          <MenuContent align="end">
            {authenticated && resource.kind === "univer" ? (
              <MenuItem disabled>
                {isEditing ? <Pencil /> : <Lock />}
                {modeLabel}
              </MenuItem>
            ) : null}
            <MenuItem
              render={
                <Link
                  to="/nodes/$nodeId"
                  params={{ nodeId: node.id }}
                  hash={true}
                  resetScroll={false}
                  search={(previous) => ({ ...previous, view: "immersive" })}
                />
              }
            >
              <Maximize />
              {t("enterImmersiveView")}
            </MenuItem>
          </MenuContent>
        </MenuRoot>
      ) : (
        <>
          {authenticated && resource.kind === "univer" ? (
            <Tooltip content={modeLabel}>
              <span
                aria-label={modeLabel}
                className="grid size-8 shrink-0 place-items-center text-secondary-foreground [&_svg]:size-4"
              >
                {isEditing ? <Pencil aria-hidden="true" /> : <Lock aria-hidden="true" />}
              </span>
            </Tooltip>
          ) : null}
          <Tooltip content={t("enterImmersiveView")}>
            <Link
              to="/nodes/$nodeId"
              params={{ nodeId: node.id }}
              aria-label={t("enterImmersiveView")}
              hash={true}
              resetScroll={false}
              search={(previous) => ({ ...previous, view: "immersive" })}
              className={cn(
                buttonVariants({ variant: "ghost", size: "icon-sm" }),
                "shrink-0 text-muted-foreground no-underline [&_svg]:size-4",
              )}
            >
              <Maximize strokeWidth={1.75} />
            </Link>
          </Tooltip>
        </>
      )}
      <ShareDialog node={shareOpen ? node : null} onClose={() => setShareOpen(false)} />
    </>
  );
}
