import type { components } from "../../../../generated/http/schema.js";

export interface RepositorySearch {
  readonly q?: string;
  readonly type?: "personal" | "team";
  readonly visibility?: "public" | "private";
  readonly sort?: "desc";
}

export function parseRepositorySearch(search: Readonly<Record<string, unknown>>): RepositorySearch {
  return {
    ...(typeof search.q === "string" && search.q ? { q: search.q.slice(0, 200) } : {}),
    ...(search.type === "personal" || search.type === "team" ? { type: search.type } : {}),
    ...(search.visibility === "public" || search.visibility === "private"
      ? { visibility: search.visibility }
      : {}),
    ...(search.sort === "desc" ? { sort: search.sort } : {}),
  };
}

export function filterRepositories(
  spaces: readonly components["schemas"]["SpaceView"][],
  search: RepositorySearch,
  nameOf: (space: components["schemas"]["SpaceView"]) => string,
  locale: string,
) {
  const q = search.q?.trim().toLocaleLowerCase(locale) ?? "";
  return spaces
    .filter(
      (space) =>
        (!search.type || space.type === search.type) &&
        (!search.visibility || space.publicRead === (search.visibility === "public")) &&
        [nameOf(space), space.description, space.owner.username].some((value) =>
          value.toLocaleLowerCase(locale).includes(q),
        ),
    )
    .sort(
      (a, b) =>
        (search.sort === "desc" ? -1 : 1) *
        nameOf(a).localeCompare(nameOf(b), locale, { numeric: true }),
    );
}
