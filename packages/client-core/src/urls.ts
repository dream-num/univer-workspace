/** Browser URLs. Numbered pull requests have a stable address; older Worktrees only the ID link. */
export function repoUrl(origin: string, spaceId: string): string {
  return new URL(`/spaces/${encodeURIComponent(spaceId)}`, origin).toString();
}

export function issueUrl(origin: string, spaceId: string, number: number): string {
  return new URL(`/spaces/${encodeURIComponent(spaceId)}/issues/${String(number)}`, origin).toString();
}

export function pullUrl(
  origin: string,
  worktree: { readonly id: string; readonly number?: number | null; readonly spaceId?: string },
  unitId?: string,
  repoSpaceId?: string,
): string {
  const spaceId = worktree.spaceId ?? repoSpaceId;
  const url =
    worktree.number != null && spaceId !== undefined
      ? new URL(`/spaces/${encodeURIComponent(spaceId)}/pulls/${String(worktree.number)}`, origin)
      : new URL("/worktrees", origin);
  if (url.pathname === "/worktrees") url.searchParams.set("worktree", worktree.id);
  if (unitId !== undefined) url.searchParams.set("unit", unitId);
  return url.toString();
}
