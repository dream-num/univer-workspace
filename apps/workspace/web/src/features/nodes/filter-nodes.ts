import type { components } from "../../../../generated/http/schema.js";

type Node = components["schemas"]["NodePage"]["nodes"][number];
export type NodeFilter = "all" | "group" | "blob" | components["schemas"]["UnitType"];

export function filterNodes(
  nodes: readonly Node[],
  typeFilter: NodeFilter,
  normalizedSearch: string,
) {
  return nodes.filter((node) => {
    const matchesType =
      typeFilter === "all" ||
      (typeFilter === "group"
        ? node.resource === null
        : typeFilter === "blob"
          ? node.resource?.kind === "blob"
          : node.resource?.kind === "univer" && node.resource.unitType === typeFilter);
    const matchesSearch =
      !normalizedSearch || node.name.toLocaleLowerCase().includes(normalizedSearch);
    return matchesType && matchesSearch;
  });
}
