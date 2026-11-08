let seen;
const state = { awaitingChangeset: null, baseRevision: 7, bufferedChangesetCount: 0, conflict: null, connection: "online", knownHeadRevision: 7, pendingMutationCount: 0 };
export default {
  async createRuntime(init) {
    seen = init.credential;
    return {
      async close() {},
      async execute() { return { state, value: seen }; },
      getState: () => state,
      async pull() { return { state, status: "up-to-date" }; },
      unitId: "unit-1", unitType: 2,
    };
  },
};
