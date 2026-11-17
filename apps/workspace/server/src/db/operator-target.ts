import type { IdentityRepository, NamedUser } from "../modules/identity/identity.repository.js";

export const describeUser = (user: NamedUser) => `${user.username} (${user.id})`;

/**
 * A username can equal another User's ID and stored IDs can differ only in case, so a target naming several
 * Users resolves to none; it names each by what matched and fails.
 */
export async function resolveOperatorTarget(identity: IdentityRepository, target: string): Promise<NamedUser | null> {
  const matches = await identity.findUsersByIdOrUsername(target);
  const isId = (user: NamedUser) => user.id.toLowerCase() === target.toLowerCase();
  if (matches.length > 1) {
    const named = [...matches]
      .sort((a, b) => Number(isId(b)) - Number(isId(a)) || (a.id < b.id ? -1 : 1))
      .map((user) => `the ${isId(user) ? "user ID" : "username"} of ${describeUser(user)}`);
    console.error(
      `${target} is ${new Intl.ListFormat("en").format(named)}. Nothing changed; name the User by the other identifier.`
    );
    process.exitCode = 1;
    return null;
  }
  const user = matches[0] ?? null;
  if (!user) {
    console.error(`No User matches ${target}`);
    process.exitCode = 1;
  }
  return user;
}
