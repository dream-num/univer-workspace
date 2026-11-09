import assert from 'node:assert/strict';

// networks: docker network inspect records keyed by network name, for every network the renderer joined.
export function assertInternalOnly(networks) {
  const entries = Object.entries(networks);
  assert(entries.length === 1, 'renderer must join exactly one network');
  for (const [name, network] of entries) assert(network.Internal === true, `renderer network ${name} must be internal`);
}

// reached: label to probe outcome, where "blocked" is the only acceptable outcome.
export function assertUnreachable(reached) {
  for (const [label, outcome] of Object.entries(reached)) assert(outcome === 'blocked', `renderer must not reach ${label} (got ${outcome})`);
  assert(Object.keys(reached).length > 0, 'at least one route must be probed');
}
