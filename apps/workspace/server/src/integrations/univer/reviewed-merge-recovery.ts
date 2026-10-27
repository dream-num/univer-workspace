import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import type { DatabaseContext, IDatabaseAdapter } from "@univerjs-pro/collaboration-service";
import type {
  IWorktreeDatabaseAdapter,
  WorktreeUnitRecord,
} from "@univerjs-pro/collaboration-worktree-service";
import type {
  ReviewedMergeJournal,
  ReviewedMergeProof,
  WorktreeUnit,
} from "../../modules/worktrees/worktrees.types.js";
import { ApplicationError } from "../../middleware/errors.js";

const require = createRequire(import.meta.url);
const { Univer, LocaleType, LogLevel } =
  require("@univerjs/core") as typeof import("@univerjs/core");
const {
  UniverCollaborationPlugin,
  ITransformService,
  parseProtocolChangeset,
  parseChangesetToProtocol,
  isTransformChangesetsFailure,
} = require("@univerjs-pro/collaboration") as typeof import("@univerjs-pro/collaboration");

const digest = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const terminal = (unit: WorktreeUnitRecord) =>
  ["merged", "unchanged", "removed"].includes(unit.mergeResult?.status ?? "");
const frozen = (sid: string, unit: WorktreeUnitRecord) => {
  const { mergeResult: _result, ...descriptor } = unit;
  return digest({ sid, descriptor });
};
const head = (unit: { unitID: string; type: number; headRevision: number } | null) =>
  digest(unit && [unit.unitID, unit.type, unit.headRevision]);
export const reviewIdentity = (unit: WorktreeUnit) =>
  digest({
    unitId: unit.unitId,
    resourceId: unit.resourceId,
    nodeId: unit.source === "trunk" ? unit.nodeId : null,
    source: unit.source,
    target: unit.target,
  });

/** SDK 1.1.0 public Adapter/service contracts only. No status rewrite, snapshot
 * replacement, or access bypass. The caller holds the runtime mutation lease.
 * Recovery reads durable SDK submission keys before deciding whether to write.
 * Missing/pruned history is unknown and deliberately fails closed. */
export class ReviewedMergeRecovery {
  constructor(
    private readonly drafts: IWorktreeDatabaseAdapter,
    private readonly trunk: IDatabaseAdapter,
  ) {}

  async committedUnitsForProof(
    context: DatabaseContext,
    worktreeId: string,
    proof: ReviewedMergeProof,
    units: readonly WorktreeUnit[],
  ) {
    const data = await this.drafts.getWorktree(context, worktreeId);
    if (!data) throw unknown();
    const ids: string[] = [];
    for (const unit of data.units) {
      if (unit.mergeResult?.status !== "merged" && unit.mergeResult?.status !== "unchanged")
        continue;
      const accepted = proof.units.find((entry) => entry.unitId === unit.unitID);
      const mapped = units.find((entry) => entry.unitId === unit.unitID);
      if (
        !accepted ||
        !mapped ||
        accepted.frozen !== frozen(data.worktree.sid, unit) ||
        accepted.identity !== reviewIdentity(mapped)
      )
        continue;
      if (!accepted.terminal && unit.source === "trunk" && unit.mergeResult.status === "merged") {
        const history = await this.history(context, unit);
        const commit = history.find(
          (change) =>
            change.sid === data.worktree.sid &&
            change.reqId === unit.readyDraftHeadRevision! - unit.baselineTrunkRevision!,
        );
        if (
          !commit ||
          commit.userID !== context.userID ||
          commit.revision !== unit.mergeResult.trunkRevision ||
          head({ ...unit, headRevision: commit.revision - 1 }) !== accepted.trunk ||
          digest(commit.mutations) !== accepted.submission
        )
          continue;
      }
      ids.push(unit.unitID);
    }
    return ids;
  }

  async validateFinalization(
    context: DatabaseContext,
    worktreeId: string,
    proof?: ReviewedMergeProof,
  ) {
    const data = await this.drafts.getWorktree(context, worktreeId);
    if (!data) throw unknown();
    for (const unit of data.units) {
      if (!unit.removed) continue;
      const accepted = proof?.units.find((entry) => entry.unitId === unit.unitID);
      // SDK `removed` excludes content; product Trash has not committed yet.
      // Unlike a real trunk commit, this terminal SDK flag cannot authorize a
      // deferred deletion after the target changed (or without old proof).
      if (
        !accepted ||
        accepted.frozen !== frozen(data.worktree.sid, unit) ||
        accepted.trunk !== head(await this.trunk.getUnit(context, unit.unitID))
      )
        throw new ApplicationError(
          "CONFLICT",
          409,
          "Pending removal cannot use the old review. Create a new Worktree and review the current version; no removal was applied.",
        );
    }
  }

  async capture(
    context: DatabaseContext,
    worktreeId: string,
    identities: ReadonlyMap<string, string>,
  ): Promise<ReviewedMergeProof> {
    const data = await this.drafts.getWorktree(context, worktreeId);
    if (!data || data.worktree.status !== "ready") throw changed();
    const units = [];
    for (const unit of data.units) {
      const identity = identities.get(unit.unitID);
      if (!identity) throw changed();
      const current = await this.trunk.getUnit(context, unit.unitID);
      let submission: string | undefined;
      if (
        unit.source === "trunk" &&
        !terminal(unit) &&
        !unit.removed &&
        unit.readyDraftHeadRevision !== unit.baselineTrunkRevision
      ) {
        if (!current) throw changed();
        submission = await this.submission(context, unit, data.worktree.sid, current.headRevision);
      }
      units.push({
        unitId: unit.unitID,
        identity,
        frozen: frozen(data.worktree.sid, unit),
        trunk: head(current),
        terminal: terminal(unit),
        ...(submission ? { submission } : {}),
      });
    }
    if (units.length !== identities.size) throw changed();
    return { format: 1, units };
  }

  private async history(context: DatabaseContext, unit: WorktreeUnitRecord, revision?: number) {
    const current = await this.trunk.getUnit(context, unit.unitID);
    if (!current || current.type !== unit.type) throw unknown();
    const from = unit.baselineTrunkRevision!,
      to = revision ?? current.headRevision;
    const rows = await this.trunk.getChangesets(context, unit.unitID, { from, to });
    if (
      to < from ||
      to > current.headRevision ||
      !rows ||
      rows.length !== to - from ||
      rows.some(
        (change, index) =>
          change.unitID !== unit.unitID ||
          change.type !== unit.type ||
          change.baseRev !== from + index ||
          change.revision !== from + index + 1,
      )
    )
      throw unknown();
    return rows;
  }

  private async submission(
    context: DatabaseContext,
    unit: WorktreeUnitRecord,
    sid: string,
    trunkRevision: number,
  ): Promise<string> {
    const baseline = unit.baselineTrunkRevision!,
      ready = unit.readyDraftHeadRevision!;
    const drafts = await this.drafts.getDraftChangesets(context, unit.worktreeID, unit.unitID, {
      from: baseline,
      to: ready,
    });
    const history = await this.history(context, unit, trunkRevision);
    if (
      !drafts ||
      !history ||
      drafts.length !== ready - baseline ||
      drafts.some(
        (change, index) =>
          change.unitID !== unit.unitID ||
          change.type !== unit.type ||
          change.baseRev !== baseline + index ||
          change.revision !== baseline + index + 1,
      )
    )
      throw unknown();
    // Use the same public OT engine as SDK merge. Bind the actual approved
    // submission too, so a forged/reused sid cannot masquerade as its result.
    const runtime = new Univer({ locale: LocaleType.EN_US, logLevel: LogLevel.SILENT });
    try {
      runtime.registerPlugin(UniverCollaborationPlugin);
      let candidate = parseProtocolChangeset({
        unitID: unit.unitID,
        type: unit.type,
        baseRev: baseline,
        revision: baseline + 1,
        sid: sid,
        reqId: ready - baseline,
        userID: context.userID,
        memberID: "review-proof",
        mutations: drafts.flatMap((change) => structuredClone(change.mutations)),
      });
      if (history.length) {
        const transformed = runtime
          .__getInjector()
          .get(ITransformService)
          .transformChangesets(
            history.map((change) => parseProtocolChangeset(structuredClone(change))),
            [candidate],
            false,
          );
        if (isTransformChangesetsFailure(transformed) || !transformed.c2Prime[0]) throw changed();
        candidate = transformed.c2Prime[0];
      }
      return digest(parseChangesetToProtocol(candidate).mutations);
    } finally {
      runtime.dispose();
    }
  }

  /** Upgrade recovery for old review_validated receipts without a version proof.
   * Only reconcile past SDK facts, then terminate the remainder for fresh Review.
   * The reconstructed hashes never authorize another content submission. */
  async terminateLegacy(
    context: DatabaseContext,
    worktreeId: string,
    journal: ReviewedMergeJournal,
  ): Promise<never> {
    const data = await this.drafts.getWorktree(context, worktreeId);
    if (!data) throw unknown();
    if (data.worktree.status === "ready") {
      journal.aborted();
      throw changed();
    }
    if (data.worktree.status !== "merging") throw unknown();
    const units = [];
    for (const unit of data.units) {
      let current = await this.trunk.getUnit(context, unit.unitID);
      let submission: string | undefined;
      if (
        !terminal(unit) &&
        !unit.removed &&
        unit.source === "trunk" &&
        unit.readyDraftHeadRevision !== unit.baselineTrunkRevision
      ) {
        const history = await this.history(context, unit);
        const commits = history.filter(
          (change) =>
            change.sid === data.worktree.sid &&
            change.reqId === unit.readyDraftHeadRevision! - unit.baselineTrunkRevision!,
        );
        if (commits.length > 1) throw unknown();
        if (commits[0]) {
          submission = await this.submission(
            context,
            unit,
            data.worktree.sid,
            commits[0].revision - 1,
          );
          current = { ...unit, headRevision: commits[0].revision - 1 };
        }
      }
      units.push({
        unitId: unit.unitID,
        frozen: frozen(data.worktree.sid, unit),
        identity: "legacy-termination-only",
        trunk: head(current),
        terminal: terminal(unit),
        ...(submission ? { submission } : {}),
      });
    }
    await this.resume(
      context,
      worktreeId,
      { format: 1, units },
      {
        ...journal,
        async authorize() {
          throw changed();
        },
      },
      async () => new Map(),
    );
    throw unknown();
  }

  async resume(
    context: DatabaseContext,
    worktreeId: string,
    proof: ReviewedMergeProof,
    journal: ReviewedMergeJournal,
    identities: () => Promise<ReadonlyMap<string, string>>,
  ) {
    let data = await this.drafts.getWorktree(context, worktreeId);
    if (
      !data ||
      !["ready", "merging", "merged"].includes(data.worktree.status) ||
      proof.format !== 1
    )
      throw changed();
    const entries = new Map(proof.units.map((unit) => [unit.unitId, unit]));
    const sid = data.worktree.sid;
    if (
      entries.size !== data.units.length ||
      data.units.some((unit) => entries.get(unit.unitID)?.frozen !== frozen(sid, unit))
    )
      throw changed();

    // A kill may occur between the trunk commit and recordUnitMergeResult.
    // The SDK's persisted sid + frozen-draft delta is its logical submission key.
    // Reconcile that exact key, never infer a commit from matching text or head.
    for (const unit of data.units) {
      const accepted = entries.get(unit.unitID)!;
      if (
        accepted.terminal ||
        unit.removed ||
        unit.source !== "trunk" ||
        unit.readyDraftHeadRevision === unit.baselineTrunkRevision
      )
        continue;
      const history = await this.history(context, unit);
      const commits = history.filter(
        (change) =>
          change.sid === data!.worktree.sid &&
          change.reqId === unit.readyDraftHeadRevision! - unit.baselineTrunkRevision!,
      );
      if (commits.length > 1) throw unknown();
      const commit = commits[0];
      if (!commit) {
        if (unit.mergeResult?.status === "merged") throw unknown();
        continue;
      }
      if (
        commit.userID !== context.userID ||
        commit.type !== unit.type ||
        head({ ...unit, headRevision: commit.revision - 1 }) !== accepted.trunk ||
        digest(commit.mutations) !== accepted.submission
      )
        throw unknown();
      if (
        unit.mergeResult?.status === "merged" &&
        unit.mergeResult.trunkRevision !== commit.revision
      )
        throw unknown();
      if (!terminal(unit)) {
        if (data.worktree.status !== "merging") throw unknown();
        const recorded = await this.drafts.recordUnitMergeResult(context, {
          worktreeID: worktreeId,
          unitID: unit.unitID,
          readyDraftHeadRevision: unit.readyDraftHeadRevision!,
          mergeResult: { status: "merged", trunkRevision: commit.revision },
        });
        if (recorded.status !== "recorded" && recorded.status !== "already-recorded")
          throw unknown();
      }
    }

    data = (await this.drafts.getWorktree(context, worktreeId))!;
    // New Units use the SDK's durable merge artifact and reserved identity.
    // Delegate duplicate detection to the SDK, but only when trunk is absent.
    // An unreceipted creation needs artifact verification before any retry.
    for (const unit of data.units) {
      if (
        entries.get(unit.unitID)!.terminal ||
        terminal(unit) ||
        unit.source !== "worktree" ||
        unit.removed
      )
        continue;
      const existing = await this.trunk.getUnit(context, unit.unitID);
      if (!existing) continue;
      const artifact = await this.drafts.getUnitMergeArtifact(context, worktreeId, unit.unitID);
      if (
        !artifact ||
        artifact.readyDraftHeadRevision !== unit.readyDraftHeadRevision ||
        existing.type !== unit.type ||
        existing.creatorID !== context.userID
      )
        throw unknown();
      const snapshot = await this.trunk.getSnapshot(context, unit.unitID, { revision: 1 });
      if (digest(snapshot) !== digest(artifact.unit.snapshot)) throw unknown();
      for (const block of artifact.unit.sheetBlocks ?? [])
        if (
          digest(await this.trunk.getSheetBlock(context, unit.unitID, block.id)) !== digest(block)
        )
          throw unknown();
      const recorded = await this.drafts.recordUnitMergeResult(context, {
        worktreeID: worktreeId,
        unitID: unit.unitID,
        readyDraftHeadRevision: unit.readyDraftHeadRevision!,
        mergeResult: { status: "merged", trunkRevision: 1 },
      });
      if (recorded.status !== "recorded" && recorded.status !== "already-recorded") throw unknown();
    }
    data = (await this.drafts.getWorktree(context, worktreeId))!;
    try {
      await journal.authorize();
      const current = await identities();
      if (
        current.size !== entries.size ||
        [...entries].some(([id, unit]) => current.get(id) !== unit.identity)
      )
        throw changed();
      for (const unit of data.units) {
        if (entries.get(unit.unitID)!.terminal || unit.mergeResult?.status === "merged") continue;
        if (
          head(await this.trunk.getUnit(context, unit.unitID)) !== entries.get(unit.unitID)!.trunk
        )
          throw changed();
      }
    } catch (error) {
      // Public SDK failed-merge convergence preserves terminal Units and frozen
      // draft history. It returns remaining Units to normal ready/reopen review.
      // No content writes occur here, including when permission was revoked.
      if (data.worktree.status === "merging") {
        for (const unit of data.units) {
          if (terminal(unit)) continue;
          const result = await this.drafts.recordUnitMergeResult(context, {
            worktreeID: worktreeId,
            unitID: unit.unitID,
            readyDraftHeadRevision: unit.readyDraftHeadRevision!,
            mergeResult: {
              status: "failed",
              error: {
                code: "REVIEW_RECOVERY_ABORTED",
                message: "Review the current version and permissions before applying again.",
                retryable: false,
              },
            },
          });
          if (result.status !== "recorded" && result.status !== "already-recorded") throw unknown();
        }
        const finished = await this.drafts.finishMerge(context, worktreeId);
        if (finished.status !== "transitioned" && finished.status !== "already-in-target")
          throw unknown();
      }
      if (data.units.some((unit) => !terminal(unit) || unit.removed)) journal.aborted();
      throw error;
    }
  }
}

const changed = () =>
  new ApplicationError(
    "CONFLICT",
    409,
    "The accepted version changed. Review the current per-Unit results before applying again.",
  );
const unknown = () =>
  new ApplicationError(
    "CONFLICT",
    409,
    "The durable SDK merge result cannot be proven. Recovery stopped without submitting content.",
  );
