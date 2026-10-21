import { ApplicationError } from "../../middleware/errors.js";

const SLUG_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;

/** `personal` addresses the owner's Personal Space and cannot name a Team Space. */
export const RESERVED_SLUG = "personal";

export function validSlug(value: unknown): string {
  if (typeof value !== "string" || !SLUG_PATTERN.test(value)) {
    throw new ApplicationError(
      "INVALID_INPUT",
      400,
      "Space slug must be 1-100 characters from letters, digits, '.', '_' and '-', starting with a letter or digit.",
      "slug"
    );
  }
  if (value.toLowerCase() === RESERVED_SLUG) {
    throw new ApplicationError(
      "INVALID_INPUT",
      400,
      `The slug "${RESERVED_SLUG}" is reserved.`,
      "slug"
    );
  }
  return value;
}

/** Derives a slug base from a Space name; names without usable characters fall back to the Space ID. */
export function slugBaseFromName(name: string, spaceId: string): string {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^[^a-z0-9]+|-+$/g, "")
    .slice(0, 100)
    .replace(/-+$/, "");
  return base && base !== RESERVED_SLUG ? base : `repo-${spaceId.replaceAll("-", "").slice(0, 8)}`;
}
