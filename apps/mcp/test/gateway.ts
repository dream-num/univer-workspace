import { createGateway as create } from "../src/gateway/server.js";

// Source tests load the same assembled directory as the built gateway.
export function createGateway(
  config: Parameters<typeof create>[0],
  options: Parameters<typeof create>[1] = {},
) {
  return create(config, {
    skillDataRoot: new URL("../dist/skill-data/", import.meta.url).pathname,
    ...options,
  });
}
