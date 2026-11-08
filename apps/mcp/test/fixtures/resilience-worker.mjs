const base = { awaitingChangeset: null, baseRevision: 7, bufferedChangesetCount: 0, conflict: null, connection: 'online', knownHeadRevision: 7, pendingMutationCount: 0 };
export default {
  createRuntime(init) {
    if (init.target.revision === 5)
      throw Object.assign(new Error('Workspace runtime target revision changed before the worker started.'), { code: 'workspace-runtime-target-stale' });
    const state = { ...base };
    let pulls = 0;
    let executions = 0;
    let code;
    return {
      close: async () => {}, unitId: 'unit-1', unitType: 2,
      getState: () => state,
      async pull() {
        if (/^workspace_session=stale(-403)?$/.test(init.credential) && ++pulls > 1)
          throw Object.assign(new Error('Collaboration HTTP request failed with status ' + (init.credential.endsWith('-403') ? 403 : 401)), { code: 'COLLABORATION_UNAVAILABLE' });
        return { state, status: 'up-to-date' };
      },
      async execute(input) {
        code = input.code;
        if (init.credential === 'workspace_session=script-stale' && ++executions > 1)
          throw Object.assign(new Error('Workspace Session is missing or expired.'), { code: 'workspace-authentication-required' });
        if (code === 'script-conflict')
          throw Object.assign(new Error('user code failure'), { code: 'workspace-result-mismatch' });
        return input.mode === 'write'
          ? { state, value: init.credential, mutations: [{ id: 'edit', data: '{}' }] }
          : { state, value: init.credential };
      },
      replacePendingMutations: async () => ({ previousMutationCount: 1, pendingMutationCount: 1, state }),
      async commit() {
        if (code === 'ambiguous-auth')
          throw Object.assign(new Error('Collaboration HTTP request failed with status 401'), { code: 'COLLABORATION_UNAVAILABLE' });
        state.baseRevision++;
        state.knownHeadRevision++;
        return { status: 'confirmed', state };
      },
    };
  },
};
