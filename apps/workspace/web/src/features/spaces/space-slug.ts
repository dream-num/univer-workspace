const SLUG_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;
const RESERVED_SLUG = "personal";

/** Mirrors the server rule; the server stays authoritative (format, `personal`, per-owner uniqueness). */
export function isValidSlug(slug: string): boolean {
  return SLUG_PATTERN.test(slug) && slug.toLowerCase() !== RESERVED_SLUG;
}

/** Slug suggested from a Space name; "" when nothing usable remains (the server then generates one). */
export function suggestSlug(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^[^a-z0-9]+|-+$/g, "")
    .slice(0, 100)
    .replace(/-+$/, "");
  return slug && slug !== RESERVED_SLUG ? slug : "";
}
