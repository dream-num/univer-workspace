import type { ProductDatabase, ProductDatabaseConfig } from "./product-database.js";
import { openSqliteProductDatabase } from "./sqlite/open.js";

const openByProvider = {
  sqlite: openSqliteProductDatabase,
};

export async function openProductDatabase(config: ProductDatabaseConfig): Promise<ProductDatabase> {
  return openByProvider[config.provider](config);
}
