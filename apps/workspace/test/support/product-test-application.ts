import { createWorkspaceApplication } from "../../server/src/app.js";
import { loadConfig, type WorkspaceConfig } from "../../server/src/config.js";
import { openProductDatabase } from "../../server/src/db/index.js";
import { createPostgresTestSchema } from "./postgres/schema.js";

export type ProductTestApplication = Awaited<ReturnType<typeof createProductTestApplication>>;

export async function createProductTestApplication(
  { productFilename, ...settings }: Partial<Omit<WorkspaceConfig, "productDatabase">> & { productFilename: string },
  dependencies?: Parameters<typeof createWorkspaceApplication>[2],
) {
  const url = process.env.WORKSPACE_TEST_POSTGRES_URL;
  const schema = url ? await createPostgresTestSchema(url) : undefined;
  const config: WorkspaceConfig = {
    ...loadConfig({}), ...settings,
    productDatabase: schema
      ? { provider: "postgres", connectionString: schema.connectionString }
      : { provider: "sqlite", filename: productFilename },
  };
  const cleanup = new AsyncDisposableStack();
  if (schema) cleanup.defer(schema.close);
  try {
    const database = await openProductDatabase(config.productDatabase);
    cleanup.defer(() => database.close());
    const application = createWorkspaceApplication(config, database.repositories, dependencies);
    cleanup.defer(() => application.close());
    await application.initialize();
    return { ...application, repositories: database.repositories, close: () => cleanup.disposeAsync() };
  } catch (error) {
    await cleanup.disposeAsync();
    throw error;
  }
}
