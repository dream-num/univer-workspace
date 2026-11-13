import type { AuthenticatedWorkspaceHttp } from "./http.js";

export type WorkspaceResolvedSkillSource =
  | { readonly kind: "git"; readonly hub: "github" | "skills-sh"; readonly owner: string; readonly repo: string; readonly commit: string; readonly path: string; readonly pageUrl: string }
  | { readonly kind: "clawhub"; readonly owner: string; readonly slug: string; readonly version: string; readonly pageUrl: string }
  | { readonly kind: "space"; readonly nodeId: string; readonly etag: string };

export interface WorkspaceSkillSourceReadInput {
  readonly source: string | WorkspaceResolvedSkillSource;
  readonly skill?: string | undefined;
  readonly path?: string | undefined;
  readonly cursor?: string | undefined;
}

/** HTTP-only source resolution. The client shell validates the returned source and files. */
export class WorkspaceSkillSourceFeature {
  public constructor(private readonly authenticatedHttp: AuthenticatedWorkspaceHttp) {}

  public async read(input: WorkspaceSkillSourceReadInput): Promise<unknown> {
    return await (await this.authenticatedHttp()).json("/api/skill-sources/read", { method: "POST", body: input });
  }
}
