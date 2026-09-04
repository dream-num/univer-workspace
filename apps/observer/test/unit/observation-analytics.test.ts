import { describe, expect, it } from "vitest";
import type { ObserverConfig } from "../../server/src/config.js";
import type { ProductDatabaseReader } from "../../server/src/product-database-reader.js";
import { ObservationAnalytics } from "../../server/src/modules/observation/observation-analytics.js";
import { ChangesetQueryTimeoutError } from "../../server/src/modules/observation/changeset-reader.js";
import type {
  ChangesetQuery,
  ChangesetQueryResult,
} from "../../server/src/modules/observation/changeset-query-types.js";

const query: ChangesetQuery = {
  from: 0,
  to: 60_000,
  userId: null,
  unitId: null,
  scope: "all",
  measure: "changesetCount",
};

describe("Observer query protection", () => {
  it("rejects a changeset query when the configured concurrency is exhausted", async () => {
    let finish: ((result: ChangesetQueryResult) => void) | undefined;
    const running = new Promise<ChangesetQueryResult>((resolve) => {
      finish = resolve;
    });
    const analytics = createAnalytics(() => running);

    const first = analytics.changesets(query);
    await expect(analytics.changesets(query)).rejects.toMatchObject({
      code: "QUERY_BUSY",
      status: 503,
    });
    finish?.(emptyResult());
    await expect(first).resolves.toMatchObject({
      totals: { changesetCount: 0 },
    });
  });

  it("maps Worker timeouts to a stable HTTP error", async () => {
    const analytics = createAnalytics(async () => {
      throw new ChangesetQueryTimeoutError(25);
    });
    await expect(analytics.changesets(query)).rejects.toMatchObject({
      code: "QUERY_TIMEOUT",
      status: 504,
    });
  });
});

function createAnalytics(
  runner: (
    filename: string,
    query: ChangesetQuery,
    timeoutMs: number
  ) => Promise<ChangesetQueryResult>
): ObservationAnalytics {
  return new ObservationAnalytics(
    {
      connection: {
        prepare() {
          return { all: () => [] };
        },
      },
    } as unknown as ProductDatabaseReader,
    config(),
    0,
    runner
  );
}

function config(): ObserverConfig {
  return {
    host: "127.0.0.1",
    port: 3030,
    productDatabaseFilename: "product.sqlite",
    collaborationDatabaseFilename: "collaboration.sqlite",
    observerDatabaseFilename: "observer.sqlite",
    blobDirectory: "blobs",
    secureCookies: false,
    sessionTtlMs: 60_000,
    queryTimeoutMs: 25,
    maxConcurrentQueries: 1,
    githubOAuth: null,
  };
}

function emptyResult(): ChangesetQueryResult {
  return {
    bucketMs: 60_000,
    buckets: [{ start: 0, changesetCount: 0, mutationCount: 0, mutationSize: 0 }],
    totals: { changesetCount: 0, mutationCount: 0, mutationSize: 0 },
    users: [],
    units: [],
    mutationSizePresentCount: 0,
    mutationSizeMissingCount: 0,
    missingCreateTimeCount: 0,
    latestChangesetTime: null,
  };
}
