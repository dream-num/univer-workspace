(async () => {
  const [{ createTrajectoryStore }, { expandRequests }] = await Promise.all([
    import("/src/features/agents/trajectory/store.ts"),
    import("/src/features/agents/trajectory/record.ts"),
  ]);
  const id = location.pathname.match(/^\/agents\/([^/]+)\/?$/)?.[1];
  if (!id) throw new Error("Open an /agents/<id> session page first.");
  const response = await fetch("/api/session");
  if (!response.ok) throw new Error(`Session lookup failed (${response.status}).`);
  const session = await response.json();
  if (!session.authenticated) throw new Error("Sign in to Workspace first.");
  const store = createTrajectoryStore({ userId: session.user.id, indexedDB, locks: navigator.locks });
  const { records, skippedRecords } = await store.list(decodeURIComponent(id));
  return {
    skippedRecords,
    records: expandRequests(records).map(({ record, body, base, rewrite }) => ({
      seq: record.seq, outcome: record.outcome, attempts: record.attempts, base, rewrite, body,
    })),
  };
})()
