import type {
  AccessRole,
  SpaceCapabilities,
  SpaceType,
} from "../access/index.js";

export type SpaceAffiliation = "owner" | "member" | "none";

/** Who besides Space Members may fork a public Team Space and propose changes to it. */
export const SPACE_PROPOSALS = ["members", "accountable", "anyone"] as const;
export type SpaceProposals = (typeof SPACE_PROPOSALS)[number];

export interface SpaceView {
  readonly id: string;
  readonly type: SpaceType;
  readonly name: string;
  readonly publicRead: boolean;
  readonly proposals: SpaceProposals;
  /** Hours after a submission at which an Issue nobody sent back is accepted; null when off. */
  readonly acceptAfterHours: number | null;
  readonly description: string;
  readonly slug: string | null;
  readonly fullName: string | null;
  readonly owner: { readonly id: string; readonly username: string };
  readonly accessRole: AccessRole;
  readonly affiliation: SpaceAffiliation;
  readonly capabilities: SpaceCapabilities;
}

export interface SpaceStar {
  readonly starred: boolean;
  readonly starCount: number;
}

export interface MySpaceView extends SpaceView {
  readonly affiliation: "owner" | "member";
}

export interface SpacePins {
  readonly customized: boolean;
  readonly limit: number;
  readonly spaces: readonly SpaceView[];
}
