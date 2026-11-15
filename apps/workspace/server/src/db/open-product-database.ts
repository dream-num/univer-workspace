import type { ProductDatabase, ProductDatabaseConfig } from "./product-database.js";
import { openSqliteProductDatabase } from "./sqlite/open.js";
import { resetSqliteProductDatabase } from "./sqlite/reset.js";

const backends = {
  sqlite: { open: openSqliteProductDatabase, reset: resetSqliteProductDatabase },
};

export async function openProductDatabase(config: ProductDatabaseConfig): Promise<ProductDatabase> {
  return backends[config.provider].open(config);
}

/** Only for an explicitly requested reset of disposable product data. */
export async function resetProductDatabase(config: ProductDatabaseConfig): Promise<void> {
  return backends[config.provider].reset(config);
}
