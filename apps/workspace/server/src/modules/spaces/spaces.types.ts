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
  readonly accessRole: AccessRole;
  readonly capabilities: SpaceCapabilities;
}
