import type {
  AccessRole,
  SpaceCapabilities,
  SpaceType,
} from "../access/index.js";

export interface SpaceView {
  readonly id: string;
  readonly type: SpaceType;
  readonly name: string;
  readonly publicRead: boolean;
  readonly description: string;
  readonly owner: { readonly id: string; readonly username: string };
  readonly accessRole: AccessRole;
  readonly capabilities: SpaceCapabilities;
}

export interface SpaceStar {
  readonly starred: boolean;
  readonly starCount: number;
}
