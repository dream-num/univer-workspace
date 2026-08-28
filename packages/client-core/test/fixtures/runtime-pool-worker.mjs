export default {
  async createRuntime() {
    return {
      async close() {},
      unitId: "unit-1",
      unitType: 2,
    };
  },
};
