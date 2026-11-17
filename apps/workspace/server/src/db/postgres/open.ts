import { Pool } from "pg";
import { logger } from "../../logging/logger.js";
import type { ProductDatabase, ProductDatabaseConfig, ProductRepositories } from "../product-database.js";
import { PostgresDatabase } from "./connection.js";
import { initializePostgresSchema } from "./initialize.js";
import { createPostgresUnitCreationFactsReader } from "./unit-creation-facts.js";
import { PostgresAccessRepository } from "./access/access.repository.js";
import { PostgresBlobsRepository } from "./blobs/blobs.repository.js";
import { PostgresContentPermissionsRepository } from "./content-permissions/content-permissions.repository.js";
import { PostgresCopiesRepository } from "./copies/copies.repository.js";
import { PostgresHtmlViewDraftsRepository } from "./html-view-drafts/drafts.repository.js";
import { PostgresIdentityRepository } from "./identity/identity.repository.js";
import { PostgresAccessTokenRepository } from "./identity/access-token.repository.js";
import { PostgresIssuesRepository } from "./issues/issues.repository.js";
import { PostgresNodesRepository } from "./nodes/nodes.repository.js";
import { PostgresOperationsRepository } from "./operations/operations.repository.js";
import { PostgresPermissionsRepository } from "./permissions/permissions.repository.js";
import { PostgresResourcesRepository } from "./resources/resources.repository.js";
import { PostgresSkillDraftsRepository } from "./skill-drafts/drafts.repository.js";
import { PostgresSpacePinsRepository } from "./spaces/space-pins.repository.js";
import { PostgresSpacesRepository } from "./spaces/spaces.repository.js";
import { PostgresTrashRepository } from "./trash/trash.repository.js";
import { PostgresUniverAssetsRepository } from "./univer-assets/univer-assets.repository.js";
import { PostgresViewsRepository } from "./views/views.repository.js";
import { PostgresWorktreesRepository } from "./worktrees/worktrees.repository.js";

export function createPostgresRepositories(database: PostgresDatabase): ProductRepositories {
  const access = new PostgresAccessRepository(database);
  const identity = new PostgresIdentityRepository(database);
  return {
    access,
    blobs: new PostgresBlobsRepository(database, access),
    contentPermissions: new PostgresContentPermissionsRepository(database, access),
    copies: new PostgresCopiesRepository(database, access),
    htmlViewDrafts: new PostgresHtmlViewDraftsRepository(database, access),
    identity,
    accessTokens: new PostgresAccessTokenRepository(database),
    issues: new PostgresIssuesRepository(database, access),
    nodes: new PostgresNodesRepository(database, access),
    operations: new PostgresOperationsRepository(database),
    permissions: new PostgresPermissionsRepository(database, access),
    resources: new PostgresResourcesRepository(database, access),
    skillDrafts: new PostgresSkillDraftsRepository(database, access),
    spacePins: new PostgresSpacePinsRepository(database.pool),
    spaces: new PostgresSpacesRepository(database.pool),
    trash: new PostgresTrashRepository(database, access),
    univerAssets: new PostgresUniverAssetsRepository(database),
    views: new PostgresViewsRepository(database),
    worktrees: new PostgresWorktreesRepository(database, access),
  };
}

export async function openPostgresProductDatabase(
  config: Extract<ProductDatabaseConfig, { provider: "postgres" }>,
): Promise<ProductDatabase> {
  const pool = new Pool({ connectionString: config.connectionString });
  pool.on("error", (error) => logger.warn({ code: "code" in error ? error.code : undefined }, "Idle PostgreSQL connection lost"));
  try {
    await initializePostgresSchema(pool);
    const database = new PostgresDatabase(pool);
    return {
      repositories: createPostgresRepositories(database),
      unitCreationFacts: createPostgresUnitCreationFactsReader(database),
      close: () => pool.end(),
    };
  } catch (error) {
    await pool.end();
    throw error;
  }
}
