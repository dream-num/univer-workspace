import type { ProductDatabase, ProductDatabaseConfig, ProductRepositories } from "../product-database.js";
import type { SqliteDatabase } from "./connection.js";
import { openWorkspaceDatabase } from "./initialize.js";
import { createSqliteUnitCreationFactsReader } from "./unit-creation-facts.js";
import { SqliteAccessRepository } from "./access/access.repository.js";
import { SqliteBlobsRepository } from "./blobs/blobs.repository.js";
import { SqliteContentPermissionsRepository } from "./content-permissions/content-permissions.repository.js";
import { SqliteHtmlViewDraftsRepository } from "./html-view-drafts/drafts.repository.js";
import { SqliteIdentityRepository } from "./identity/identity.repository.js";
import { SqliteAccessTokenRepository } from "./identity/access-token.repository.js";
import { SqliteIssuesRepository } from "./issues/issues.repository.js";
import { SqliteNodesRepository } from "./nodes/nodes.repository.js";
import { SqliteOperationsRepository } from "./operations/operations.repository.js";
import { SqlitePermissionsRepository } from "./permissions/permissions.repository.js";
import { SqliteResourcesRepository } from "./resources/resources.repository.js";
import { SqliteSkillDraftsRepository } from "./skill-drafts/drafts.repository.js";
import { SqliteSpacePinsRepository } from "./spaces/space-pins.repository.js";
import { SqliteSpacesRepository } from "./spaces/spaces.repository.js";
import { SqliteTrashRepository } from "./trash/trash.repository.js";
import { SqliteUniverAssetsRepository } from "./univer-assets/univer-assets.repository.js";
import { SqliteViewsRepository } from "./views/views.repository.js";
import { SqliteWorktreesRepository } from "./worktrees/worktrees.repository.js";

export function createSqliteRepositories(database: SqliteDatabase): ProductRepositories {
  const access = new SqliteAccessRepository(database);
  const identity = new SqliteIdentityRepository(database);
  return {
    access,
    blobs: new SqliteBlobsRepository(database, access),
    contentPermissions: new SqliteContentPermissionsRepository(database, access),
    htmlViewDrafts: new SqliteHtmlViewDraftsRepository(database, access),
    identity,
    accessTokens: new SqliteAccessTokenRepository(database),
    issues: new SqliteIssuesRepository(database, access),
    nodes: new SqliteNodesRepository(database, access),
    operations: new SqliteOperationsRepository(database),
    permissions: new SqlitePermissionsRepository(database, access),
    resources: new SqliteResourcesRepository(database, access),
    skillDrafts: new SqliteSkillDraftsRepository(database, access),
    spacePins: new SqliteSpacePinsRepository(database),
    spaces: new SqliteSpacesRepository(database),
    trash: new SqliteTrashRepository(database, access),
    univerAssets: new SqliteUniverAssetsRepository(database),
    views: new SqliteViewsRepository(database),
    worktrees: new SqliteWorktreesRepository(database, access),
  };
}

export function openSqliteProductDatabase({ filename }: Extract<ProductDatabaseConfig, { provider: "sqlite" }>): ProductDatabase {
  const database = openWorkspaceDatabase(filename);
  try {
    return {
      repositories: createSqliteRepositories(database),
      unitCreationFacts: createSqliteUnitCreationFactsReader(database.connection),
      async close() { database.close(); },
    };
  } catch (error) {
    database.close();
    throw error;
  }
}
