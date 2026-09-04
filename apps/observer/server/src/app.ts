import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { apiReference } from "@scalar/express-api-reference";
import express from "express";
import type { ObserverConfig } from "./config.js";
import { errorHandler, notFoundHandler } from "./errors.js";
import {
  createGitHubOAuthProvider,
  type GitHubOAuthProvider,
} from "./github-oauth.js";
import {
  createObservationModule,
  createObservationRouter,
  ObservationAnalytics,
  ObservationDatabase,
  ObservationRepository,
  type ObservationModule,
} from "./modules/observation/index.js";
import { ProductDatabaseReader } from "./product-database-reader.js";

export interface ObserverApplication {
  readonly app: express.Express;
  readonly productDatabase: ProductDatabaseReader;
  readonly observerDatabase: ObservationDatabase;
  readonly observation: ObservationModule;
  close(): void;
}

export function createObserverApplication(
  config: ObserverConfig,
  dependencies: {
    readonly githubOAuthProvider?: GitHubOAuthProvider;
    readonly oauthStateSecret?: string;
  } = {}
): ObserverApplication {
  const productDatabase = new ProductDatabaseReader(
    config.productDatabaseFilename
  );
  let observerDatabase: ObservationDatabase;
  try {
    observerDatabase = new ObservationDatabase(config.observerDatabaseFilename);
  } catch (error) {
    productDatabase.close();
    throw error;
  }

  const oauthStateSecret =
    dependencies.oauthStateSecret ?? config.githubOAuth?.clientSecret;
  const observation = createObservationModule({
    repository: new ObservationRepository(observerDatabase),
    sessionTtlMs: config.sessionTtlMs,
    githubOAuthProvider:
      dependencies.githubOAuthProvider ??
      (config.githubOAuth
        ? createGitHubOAuthProvider(config.githubOAuth)
        : null),
    ...(oauthStateSecret ? { oauthStateSecret } : {}),
    ...(config.setupToken ? { setupToken: config.setupToken } : {}),
  });
  const analytics = new ObservationAnalytics(
    productDatabase,
    config,
    Date.now()
  );
  const app = express();
  app.disable("x-powered-by");
  app.get("/healthz", (_request, response) => {
    response.json({ status: "ok" });
  });
  app.get("/openapi.yaml", (_request, response) => {
    const filename = resolve("generated/http/openapi.bundled.yaml");
    if (!existsSync(filename)) {
      response
        .status(503)
        .type("text/plain")
        .send("OpenAPI bundle is unavailable. Run `pnpm api:bundle`.");
      return;
    }
    response.type("application/yaml").sendFile(filename);
  });
  app.use(
    "/api-docs",
    apiReference({
      url: "/openapi.yaml",
      theme: "default",
      pageTitle: "Univer Observer API",
    })
  );
  app.use(
    "/api",
    createObservationRouter({
      observation,
      analytics,
      secureCookies: config.secureCookies,
    })
  );
  app.use("/api", notFoundHandler);

  const publicDirectory = resolve("dist/public");
  if (existsSync(publicDirectory)) {
    app.use(express.static(publicDirectory));
    app.get("/{*path}", (_request, response) => {
      response.sendFile(resolve(publicDirectory, "index.html"));
    });
  }
  app.use(notFoundHandler);
  app.use(errorHandler);

  return {
    app,
    productDatabase,
    observerDatabase,
    observation,
    close() {
      try {
        observerDatabase.close();
      } finally {
        productDatabase.close();
      }
    },
  };
}
