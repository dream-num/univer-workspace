import { opSpecs } from "./executor-protocol.js";

export function truncateCommittedExecute(output: unknown) {
  const result = opSpecs["content.execute"].output.safeParse(output);
  if (!result.success || !result.data.committed) return undefined;
  const { revision, status } = result.data;
  return {
    committed: true,
    ...(revision === undefined ? {} : { revision }),
    ...(status === undefined ? {} : { status }),
    valueTruncated: true as const,
  };
}
