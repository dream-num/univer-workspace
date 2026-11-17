import type { IdentityRepository, NamedUser } from "../modules/identity/identity.repository.js";

export const describeUser = (user: NamedUser) => `${user.username} (${user.id})`;

/** A username can equal another User's ID, so a target naming two Users resolves to neither; it prints both and fails. */
export async function resolveOperatorTarget(identity: IdentityRepository, target: string): Promise<NamedUser | null> {
  const matches = await identity.findUsersByIdOrUsername(target);
  const byId = matches.find((user) => user.id.toLowerCase() === target.toLowerCase());
  const byUsername = matches.find((user) => user !== byId);
  if (byId && byUsername) {
    console.error(
      `${target} is the user ID of ${describeUser(byId)} and the username of ${describeUser(byUsername)}. ` +
      "Nothing changed; name the User by the other identifier."
    );
    process.exitCode = 1;
    return null;
  }
  const user = byId ?? byUsername ?? null;
  if (!user) {
    console.error(`No User matches ${target}`);
    process.exitCode = 1;
  }
  return user;
}
