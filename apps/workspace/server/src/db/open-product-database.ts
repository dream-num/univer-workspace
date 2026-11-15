import type { ProductDatabase, ProductDatabaseConfig } from "./product-database.js";
import { openSqliteProductDatabase } from "./sqlite/open.js";

export async function openProductDatabase(config: ProductDatabaseConfig): Promise<ProductDatabase> {
  if (config.provider === "sqlite") return openSqliteProductDatabase(config);
  const { openPostgresProductDatabase } = await import("./postgres/open.js");
  return openPostgresProductDatabase(config);
}
