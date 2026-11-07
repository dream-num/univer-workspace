import { existsSync, writeFileSync } from "node:fs";

const state = {
  awaitingChangeset: null,
  baseRevision: 7,
  bufferedChangesetCount: 0,
  conflict: null,
  connection: "online",
  knownHeadRevision: 7,
  pendingMutationCount: 0,
};

export default {
  async createRuntime() {
    return {
      async close() {},
      async execute({ code }) {
        if (code.startsWith("hold:")) {
          writeFileSync(code.slice(5), "held");
          await new Promise((resolve) => setTimeout(resolve, 1000));
        }
        if (code.startsWith("gate:")) {
          const gate = code.slice(5);
          writeFileSync(`${gate}.started`, "");
          while (!existsSync(`${gate}.release`)) {
            await new Promise((resolve) => setTimeout(resolve, 10));
          }
        }
        return { state, value: Object.keys(process.env) };
      },
      getState: () => state,
      async pull() {
        return { state, status: "up-to-date" };
      },
      unitId: "unit-1",
      unitType: 2,
    };
  },
};
