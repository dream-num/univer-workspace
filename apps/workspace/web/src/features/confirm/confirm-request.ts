import type { MessageKey } from "../../shared/i18n";

const TEAM_ROLES = ["admin", "editor", "viewer"] as const;
const GRANT_ROLES = ["editor", "viewer"] as const;
type TeamRole = (typeof TEAM_ROLES)[number];
type GrantRole = (typeof GRANT_ROLES)[number];

/** The browser's copy of the changes the server links to. `test/confirm-links.test.ts` fails when the two lists disagree. */
export type ConfirmRequest =
  | { readonly action: "public"; readonly spaceId: string }
  | { readonly action: "member"; readonly spaceId: string; readonly userId: string; readonly role: TeamRole }
  | { readonly action: "grant"; readonly nodeId: string; readonly userId: string; readonly role: GrantRole }
  | { readonly action: "link-sharing"; readonly nodeId: string; readonly role: GrantRole };

/** What the target allows before or after the change. `null` is private, not a member, not shared, or link off. */
export type ConfirmLevel = TeamRole | "public" | null;

/** Reads only the action's own keys. Any other key is ignored, and a missing or unknown value makes the link invalid. */
export function parseConfirmRequest(action: string, search: URLSearchParams): ConfirmRequest | null {
  const role = <R extends string>(roles: readonly R[]) => roles.find((value) => value === search.get("role"));
  const [spaceId, nodeId, userId] = [search.get("space"), search.get("node"), search.get("user")];
  if (action === "public") return spaceId ? { action, spaceId } : null;
  if (action === "member") {
    const team = role(TEAM_ROLES);
    return spaceId && userId && team ? { action, spaceId, userId, role: team } : null;
  }
  const grant = role(GRANT_ROLES);
  if (action === "grant") return nodeId && userId && grant ? { action, nodeId, userId, role: grant } : null;
  if (action === "link-sharing") return nodeId && grant ? { action, nodeId, role: grant } : null;
  return null;
}

/** Names the person's own session read. Nothing from the link is shown. */
export interface ConfirmNames {
  readonly repository?: string | undefined;
  readonly file?: string | undefined;
  readonly folder?: boolean | undefined;
  readonly user?: string | undefined;
}

type Translate = (key: MessageKey, values?: Readonly<Record<string, string | number>>) => string;

const MEMBER: Readonly<Record<TeamRole, MessageKey>> = { viewer: "confirmMemberViewer", editor: "confirmMemberEditor", admin: "confirmMemberAdmin" };
const GRANT: Readonly<Record<GrantRole, MessageKey>> = { viewer: "confirmGrantViewer", editor: "confirmGrantEditor" };
const LINK: Readonly<Record<GrantRole, MessageKey>> = { viewer: "confirmLinkViewer", editor: "confirmLinkEditor" };

export function confirmText(request: ConfirmRequest, names: ConfirmNames, t: Translate): { readonly title: string; readonly consequence: string } {
  const values = { repository: names.repository ?? "", file: names.file ?? "", user: names.user ?? "" };
  const covers = names.folder ? ` ${t("confirmFolderCovers")}` : "";
  switch (request.action) {
    case "public":
      return { title: t("confirmPublicTitle", values), consequence: t("confirmPublicConsequence", values) };
    case "member":
      return { title: t("confirmMemberTitle", values), consequence: t(MEMBER[request.role], values) };
    case "grant":
      return { title: t("confirmGrantTitle", values), consequence: t(GRANT[request.role], values) + covers };
    case "link-sharing":
      return { title: t("confirmLinkTitle", values), consequence: t(LINK[request.role], values) + covers };
  }
}

const ABSENT: Readonly<Record<ConfirmRequest["action"], MessageKey>> = {
  "public": "repositoryVisibilityPrivate", "member": "confirmNotMember", "grant": "confirmNotShared", "link-sharing": "linkSharingOff",
};
const ROLE: Readonly<Record<TeamRole, MessageKey>> = { admin: "accessAdmin", editor: "accessEditor", viewer: "accessViewer" };

export function confirmLevelLabel(action: ConfirmRequest["action"], level: ConfirmLevel, t: Translate): string {
  return t(level === null ? ABSENT[action] : level === "public" ? "repositoryVisibilityPublic" : ROLE[level]);
}
