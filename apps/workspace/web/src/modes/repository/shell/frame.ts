import type { RepositoryTab } from "../repository-tabs";
import type { RepositoryGlobalView, WorkspaceShellProps } from "../../shell.types";

export type GlobalNav = RepositoryGlobalView;
export type Frame =
  | { readonly kind: "home" }
  | { readonly kind: "global"; readonly view: GlobalNav }
  | { readonly kind: "repository"; readonly spaceId: string; readonly tab: RepositoryTab }
  | { readonly kind: "document" }
  | { readonly kind: "immersive" };

export function resolveFrame(props: WorkspaceShellProps): Frame {
  if (props.immersive) return { kind: "immersive" };
  if (props.contentMode === "editor") return { kind: "document" };
  if (props.repositoryView === "home" || props.repositoryHome) return { kind: "home" };
  if (props.repositoryView) return { kind: "global", view: props.repositoryView };
  if (props.selectedSpaceId) {
    return {
      kind: "repository",
      spaceId: props.selectedSpaceId,
      tab: props.repositoryTab ?? "files",
    };
  }
  if (props.selectedView === "home") return { kind: "home" };
  if (props.selectedView === "apps" || props.selectedView === "issues") {
    return { kind: "global", view: props.selectedView };
  }
  return { kind: "document" };
}
