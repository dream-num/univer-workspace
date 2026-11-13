import type { AuthenticatedWorkspaceHttp } from "./http.js";
import type { WorkspaceResolvedSkillSource } from "./skill-source.js";

export interface WorkspaceSkillReviewFinding {
  readonly rule: "requires-shell" | "requires-binary" | "requires-local-io" | "unavailable-tool" | "suspicious-instruction";
  readonly path: string;
  readonly quote: string;
  readonly impact: string;
  readonly suggestion: string;
}

export type WorkspaceSkillDraftInput = {
  readonly name: string;
  readonly spaceId: string;
  readonly replace?: boolean;
  readonly keep?: readonly string[];
  readonly review: readonly WorkspaceSkillReviewFinding[];
} & (
  | { readonly files: readonly { readonly path: string; readonly text: string }[]; readonly from?: never }
  | { readonly files?: never; readonly from: {
    readonly source: WorkspaceResolvedSkillSource;
    readonly skill: string;
    readonly overrides?: readonly { readonly path: string; readonly text: string | null }[] | undefined;
  } }
);

/** HTTP-only draft intake and status. The client shell validates the returned draft. */
export class WorkspaceSkillDraftFeature {
  public constructor(private readonly authenticatedHttp: AuthenticatedWorkspaceHttp) {}

  public async create(input: WorkspaceSkillDraftInput, idempotencyKey: string): Promise<unknown> {
    const body = await (await this.authenticatedHttp()).json("/api/skill-drafts", {
      method: "POST", body: input, idempotencyKey,
    });
    return body["draft"];
  }

  public async get(id: string): Promise<unknown> {
    const body = await (await this.authenticatedHttp()).json(`/api/skill-drafts/${encodeURIComponent(id)}`);
    return body["draft"];
  }
}
