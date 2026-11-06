import type {
  AccessRole,
  SpaceCapabilities,
  SpaceType,
} from "../access/index.js";

export type SpaceAffiliation = "owner" | "member" | "none";

export interface SpaceView {
  readonly id: string;
  readonly type: SpaceType;
  readonly name: string;
  readonly publicRead: boolean;
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
