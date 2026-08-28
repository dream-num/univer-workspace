interface ViewerOwner {
  readonly token: object;
  readonly collapse: () => void;
}

const owners = new Map<string, ViewerOwner>();

/** Claim a Unit for one expanded surface and return its release function. */
export function claimExclusiveViewer(unitId: string, token: object, collapse: () => void): () => void {
  const previous = owners.get(unitId);
  if (previous !== undefined && previous.token !== token) previous.collapse();

  owners.set(unitId, { token, collapse });
  return () => {
    if (owners.get(unitId)?.token === token) owners.delete(unitId);
  };
}
