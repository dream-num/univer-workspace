import type { AccessRepository } from "../modules/access/index.js";
import type { BlobsRepository } from "../modules/blobs/index.js";
import type { ContentPermissionsRepository } from "../modules/content-permissions/index.js";
import type { HtmlViewDraftsRepository } from "../modules/html-view-drafts/index.js";
import type { AccessTokenRepository, IdentityRepository } from "../modules/identity/index.js";
import type { IssuesRepository } from "../modules/issues/index.js";
import type { NodesRepository } from "../modules/nodes/index.js";
import type { OperationsRepository } from "../modules/operations/index.js";
import type { PermissionsRepository } from "../modules/permissions/index.js";
import type { ResourcesRepository } from "../modules/resources/index.js";
import type { SkillDraftsRepository } from "../modules/skill-drafts/index.js";
import type { SpacePinsRepository, SpacesRepository } from "../modules/spaces/index.js";
import type { TrashRepository } from "../modules/trash/index.js";
import type { UniverAssetsRepository } from "../modules/univer-assets/index.js";
import type { ViewsRepository } from "../modules/views/index.js";
import type { WorktreesRepository } from "../modules/worktrees/index.js";
import type { UnitCreationFactsReader } from "./unit-creation-facts.js";

export interface ProductDatabaseConfig {
  readonly provider: "sqlite";
  readonly filename: string;
}

export interface ProductRepositories {
  readonly access: AccessRepository;
  readonly blobs: BlobsRepository;
  readonly contentPermissions: ContentPermissionsRepository;
  readonly htmlViewDrafts: HtmlViewDraftsRepository;
  readonly identity: IdentityRepository;
  readonly accessTokens: AccessTokenRepository;
  readonly issues: IssuesRepository;
  readonly nodes: NodesRepository;
  readonly operations: OperationsRepository;
  readonly permissions: PermissionsRepository;
  readonly resources: ResourcesRepository;
  readonly skillDrafts: SkillDraftsRepository;
  readonly spacePins: SpacePinsRepository;
  readonly spaces: SpacesRepository;
  readonly trash: TrashRepository;
  readonly univerAssets: UniverAssetsRepository;
  readonly views: ViewsRepository;
  readonly worktrees: WorktreesRepository;
}

export interface ProductDatabase {
  readonly repositories: ProductRepositories;
  readonly unitCreationFacts: UnitCreationFactsReader;
  close(): Promise<void>;
}
