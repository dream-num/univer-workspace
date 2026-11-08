const state = { awaitingChangeset: null, baseRevision: 7, bufferedChangesetCount: 0, conflict: null, connection: "online", knownHeadRevision: 7, pendingMutationCount: 0 };
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
export default {
  createRuntime() {
    let commitTimeout = false;
    let commitCode;
    let invalidCommitStatus = false;
    return {
      close: async () => {}, unitId: "unit-1", unitType: 2,
      getState: () => state,
      pull: async () => ({ state, status: "up-to-date" }),
      async execute({ code, mode }) {
        commitTimeout = code === "commit-timeout";
        invalidCommitStatus = code === "commit-invalid-status";
        commitCode = code.startsWith("commit-coded:") ? code.slice("commit-coded:".length) : undefined;
        if (commitCode || invalidCommitStatus || commitTimeout || code === "commit-failure")
          return { mutations: [{ id: "edit", data: "{}" }], value: null, state };
        const value = await new AsyncFunction("workbook", code)({});
        return mode === "write" ? { mutations: [], value, state } : { value, state };
      },
      replacePendingMutations: async () => ({ previousMutationCount: 1, pendingMutationCount: 1, state }),
      commit: async () => {
        if (invalidCommitStatus) return { state, status: "submitted-but-unrecognized" };
        if (commitCode) throw Object.assign(new Error("commit response lost"), { code: commitCode });
        if (commitTimeout) throw new DOMException("commit timed out", "TimeoutError");
        throw new Error("commit response lost");
      },
    };
  },
};
