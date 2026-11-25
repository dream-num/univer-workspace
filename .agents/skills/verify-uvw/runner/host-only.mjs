// The journeys the runner leaves to the host, each with why it cannot run in a runner container. A key is a whole
// feature or `<feature>:<journey ID>`.
export const HOST_ONLY = new Map([
  ['mcp-security', 'checks the container, image and network isolation that only the image start mode has'],
  ['mcp:M10', 'starts a gateway container with docker run --network none'],
  ['mcp:M12', "lists the run's Docker containers, networks, volumes and image after down"],
  ['mcp-auth:MA8', 'starts the Workspace Agent with agent-up, which has not been tried on Linux'],
  ['mcp-executor:MX3', 'stops the executor with docker stop'],
  ['mcp-executor:MX11', 'mcp-resilience.mjs reads role logs with docker logs and gateway metrics with docker exec'],
  ['mcp-executor:MX12', 'mcp-resilience.mjs reads role logs with docker logs'],
  ['mcp-executor:MX13', 'mcp-resilience.mjs stops and kills executor containers, and its slow write calls back through host.docker.internal'],
  ['mcp-executor:MX14', 'mcp-resilience.mjs calls the executor from the gateway container with docker exec'],
  ['mcp-executor:MX15', 'mcp-resilience.mjs reads role logs with docker logs'],
  ['mcp-production:MB1', 'mcp-availability.mjs stops the executor container with docker stop'],
  ['sheet-lens:SLM1', 'compares head with an instance of the base checkout'],
  ['agent-trajectory:TR2-1', 'compares head with a trunk checkout'],
  ['agent-trajectory:TR2-11', 'times head against a trunk checkout'],
]);
