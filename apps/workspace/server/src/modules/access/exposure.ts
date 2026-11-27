import client from "prom-client";
import { ApplicationError } from "../../middleware/errors.js";
import { personInBrowser, principalCategory, type Principal, type PrincipalCategory } from "../identity/index.js";
import type { AccessRole } from "./access.types.js";

type TeamRole = Exclude<AccessRole, "owner">;
type GrantRole = Exclude<TeamRole, "admin">;
type Level = TeamRole | "public";

/**
 * A write that can let more principals see data, named by the state it sets. A write that only
 * narrows (make private, remove a member or a grant, turn a link off) has no variant, so it never
 * builds a change. `kind` is also the confirm page's path segment.
 */
export type ExposureChange =
  | { readonly kind: "public"; readonly spaceId: string }
  | { readonly kind: "member"; readonly spaceId: string; readonly userId: string; readonly role: TeamRole }
  | { readonly kind: "grant"; readonly nodeId: string; readonly userId: string; readonly role: GrantRole }
  | { readonly kind: "link-sharing"; readonly nodeId: string; readonly role: GrantRole }
  | { readonly kind: "create-public" };

type Confirmable = Exclude<ExposureChange, { readonly kind: "create-public" }>;

type LevelOf<C extends ExposureChange> = C extends { readonly role: infer R extends Level } ? R : "public";

/**
 * A repository calls it with the level it read inside the write's own transaction, before it
 * writes. `null` means private, not a member, no grant, or link off. A throw aborts the
 * transaction, so a refused write changes nothing.
 */
export type ExposureGuard<L extends Level> = (before: L | null) => void;

export function exposureGuard<C extends ExposureChange>(actor: Principal, change: C | null): ExposureGuard<LevelOf<C>> {
  return (before) => {
    if (change !== null && widens(change, before) && !personInBrowser(actor)) throw countedRefusal(actor, change);
  };
}

const RANK: Readonly<Record<Level, number>> = { public: 1, viewer: 1, editor: 2, admin: 3 };

function widens(change: ExposureChange, before: Level | null): boolean {
  return before === null || RANK["role" in change ? change.role : "public"] > RANK[before];
}

const REFUSED: Readonly<Record<ExposureChange["kind"], string>> = {
  "public": "Making a repository public needs a person to confirm it in the browser.",
  "member": "Adding a repository member or raising a member's role needs a person to confirm it in the browser.",
  "grant": "Sharing a file with a person or raising their role needs a person to confirm it in the browser.",
  "link-sharing": "Turning on Link Sharing or letting link visitors edit needs a person to confirm it in the browser.",
  "create-public": "A repository is created private. Create it, then make it public, which needs a person to confirm it in the browser.",
};
const UNCLAIMED_REFUSED =
  "An unclaimed agent's files can already be viewed by anyone who has a file's link, so give the user that link. Making a repository public, adding people and letting link visitors edit wait until a person takes you, because no person can confirm them for you. Get a handoff link with claim (uvw claim in the CLI) and give it to the user. Once they sign in and take you, try again.";

const refusalCode = (category: PrincipalCategory) =>
  category === "agent_unclaimed" ? "AGENT_NOT_ALLOWED" : "INTERACTIVE_SESSION_REQUIRED";

const refusals = new client.Counter({
  name: "workspace_exposure_refusals_total",
  help: "Writes refused because they would let more people see data without a person in a browser",
  labelNames: ["change", "code", "principal_category"],
});
// A series that starts at zero lets increase() count the first refusal after a restart.
for (const change of Object.keys(REFUSED)) {
  for (const category of ["human", "agent_claimed", "agent_unclaimed"] as const) {
    refusals.inc({ change, code: refusalCode(category), principal_category: category }, 0);
  }
}

function countedRefusal(actor: Principal, change: ExposureChange): ApplicationError {
  const category = principalCategory(actor.user);
  const code = refusalCode(category);
  refusals.inc({ change: change.kind, code, principal_category: category });
  if (category === "agent_unclaimed") return new ApplicationError(code, 403, UNCLAIMED_REFUSED);
  return new ApplicationError(
    code, 403, REFUSED[change.kind], undefined, undefined,
    change.kind === "create-public" ? undefined : confirmPath(change),
  );
}

function confirmPath(change: Confirmable): string {
  const query =
    change.kind === "public" ? { space: change.spaceId }
    : change.kind === "member" ? { space: change.spaceId, user: change.userId, role: change.role }
    : change.kind === "grant" ? { node: change.nodeId, user: change.userId, role: change.role }
    : { node: change.nodeId, role: change.role };
  return `/confirm/${change.kind}?${new URLSearchParams(query)}`;
}
