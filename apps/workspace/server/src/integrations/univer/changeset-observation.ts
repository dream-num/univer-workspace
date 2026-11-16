import type { ChangesetRecord } from "@univerjs-pro/collaboration-service";

/** Both commit hooks see the final mutations after OT and share this metadata convention. */
export function setFinalMutationSize(changeset: Pick<ChangesetRecord, "metadata" | "mutations">): void {
  changeset.metadata.mutationSize = Buffer.byteLength(JSON.stringify(changeset.mutations), "utf8");
}
