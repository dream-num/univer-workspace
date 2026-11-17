import { deriveUserDisplayName, isUnsafeDisplayName, personalSpaceName } from "../modules/identity/display-name.js";

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

/**
 * Single entry of the display-name data repair. Two product versions run it over every User and Personal Space:
 * V22 (SQLite V21 → V22 and V0, PostgreSQL schema version 1 → 2) and V25 (SQLite V24 → V25, PostgreSQL 4 → 5).
 * V25 converges a database whose V22 ran an earlier rule (deployed from 47dc9277) and kept names that rule
 * missed; after the current V22 its plan is empty. Neither run can bring back a joiner that earlier rule removed
 * from a legitimate name: only that environment's backup from before V22 holds it.
 * Scope: a `users.display_name` holding an email address, a misleading character or nothing visible, and a
 * Personal Space whose default name holds its owner's old display name or such a name. Every other value
 * stays byte-identical, and a plan over its own output is empty. Callers commit the plan with the version
 * change in one transaction, so a failure keeps the old version. Exit: once every deployed SQLite database
 * is on V25 and every deployed PostgreSQL product schema on version 5, delete this file with the SQLite
 * migrations and leave the PostgreSQL version 2 and 5 upgrades empty.
 */
export function planDisplayNameRepair(
  users: readonly StoredDisplayName[],
  personalSpaces: readonly StoredPersonalSpaceName[],
): DisplayNameRepair {
  const names = new Map(users.map((user) => [user.id, {
    before: user.display_name,
    after: isUnsafeDisplayName(user.display_name) ? deriveUserDisplayName(user.display_name, user.username) : user.display_name,
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
      return (held === owner.before || isUnsafeDisplayName(held)) && name !== space.name ? [{ id: space.id, name }] : [];
    }),
  };
}
