/**
 * The Collaboration middleware exposes the final candidate as readonly even
 * though the current SDK has no supported hook for attaching persisted
 * metadata. Keep the deliberate escape in this one helper.
 */
export function setFinalMutationSize(changeset: Readonly<{
  readonly mutations: readonly unknown[];
  readonly mutationSize?: number | undefined;
}>): void {
  const mutable = changeset as { mutationSize?: number | undefined };
  mutable.mutationSize = Buffer.byteLength(
    JSON.stringify(changeset.mutations),
    "utf8"
  );
}
