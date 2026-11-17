import { deriveDisplayName, personalSpaceName } from "../modules/identity/display-name.js";

export interface StoredDisplayName {
  readonly id: string;
  readonly username: string;
  readonly display_name: string;
}

export interface StoredPersonalSpaceName {
  readonly id: string;
  readonly owner_user_id: string;
  readonly name: string;
}

export interface DisplayNameRepair {
  readonly users: readonly { readonly id: string; readonly displayName: string }[];
  readonly spaces: readonly { readonly id: string; readonly name: string }[];
}

const DEFAULT_NAME_SUFFIX = personalSpaceName("");

export function planDisplayNameRepair(
  users: readonly StoredDisplayName[],
  personalSpaces: readonly StoredPersonalSpaceName[],
): DisplayNameRepair {
  const names = new Map(users.map((user) => [user.id, {
    before: user.display_name,
    after: deriveDisplayName(user.display_name) || user.username,
  }]));
  return {
    users: users.flatMap((user) => {
      const { after } = names.get(user.id)!;
      return after === user.display_name ? [] : [{ id: user.id, displayName: after }];
    }),
    spaces: personalSpaces.flatMap((space) => {
      const owner = names.get(space.owner_user_id);
      if (!owner || !space.name.endsWith(DEFAULT_NAME_SUFFIX)) return [];
      const held = space.name.slice(0, -DEFAULT_NAME_SUFFIX.length);
      const name = personalSpaceName(owner.after);
      const heldByOwnerName = held === owner.before;
      const heldByUnrepairedName = deriveDisplayName(held) !== held;
      return (heldByOwnerName || heldByUnrepairedName) && name !== space.name ? [{ id: space.id, name }] : [];
    }),
  };
}
