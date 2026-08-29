import { json, Router } from "express";
import { ApplicationError } from "../../errors.js";
import type { ObservationAnalytics } from "./observation-analytics.js";
import type { ObservationModule } from "./observation-service.js";
import type {
  ChangesetMeasure,
  ChangesetQuery,
  ChangesetScope,
} from "./changeset-query-types.js";

const MAX_RANGE_MS = 30 * 24 * 60 * 60 * 1_000;

export function createObservationRouter(options: {
  readonly observation: ObservationModule;
  readonly analytics: ObservationAnalytics;
  readonly secureCookies: boolean;
}): Router {
  const router = Router();
  const { observation, analytics } = options;

  router.get("/status", (request, response) => {
    response.json(observation.status(request.headers.cookie));
  });

  router.post(
    "/setup",
    json({ limit: "4kb" }),
    (request, response) => {
      const started = observation.startOAuth({
        mode: "setup",
        setupToken: request.body?.token,
        returnTo: "/",
      });
      setOAuthCookie(response, observation, started.cookieValue, options.secureCookies);
      response.json({ authorizationUrl: started.authorizationUrl });
    }
  );

  router.get("/auth/github/login", (request, response) => {
    const started = observation.startOAuth({
      mode: "login",
      returnTo: request.query.returnTo,
    });
    setOAuthCookie(response, observation, started.cookieValue, options.secureCookies);
    response.redirect(started.authorizationUrl);
  });

  router.get("/auth/github/callback", async (request, response) => {
    try {
      const result = await observation.finishOAuth({
        code: request.query.code,
        state: request.query.state,
        providerError: request.query.error,
        cookieHeader: request.headers.cookie,
      });
      response.clearCookie(observation.oauthCookieName, { path: "/" });
      response.cookie(observation.cookieName, result.sessionCookieValue, {
        httpOnly: true,
        sameSite: "lax",
        secure: options.secureCookies,
        path: "/",
        maxAge: observation.sessionTtlMs,
      });
      response.redirect(result.returnTo);
    } catch (error) {
      response.clearCookie(observation.oauthCookieName, { path: "/" });
      const message = error instanceof Error ? error.message : "GitHub authentication failed.";
      response.redirect(`/login?oauthError=${encodeURIComponent(message)}`);
    }
  });

  router.delete("/session", (request, response) => {
    observation.logout(request.headers.cookie);
    response.clearCookie(observation.cookieName, { path: "/" });
    response.status(204).end();
  });

  router.use((request, _response, next) => {
    try {
      observation.requireMember(request.headers.cookie);
      next();
    } catch (error) {
      next(error);
    }
  });

  router.get("/overview", (_request, response) => {
    response.json(analytics.overview());
  });
  router.get("/operations", (_request, response) => {
    response.json(analytics.operations());
  });
  router.get("/storage", (_request, response) => {
    response.json(analytics.storage());
  });
  router.get("/config", (_request, response) => {
    response.json(analytics.configSummary());
  });
  router.get("/filter-options", (request, response) => {
    const search = typeof request.query.search === "string"
      ? request.query.search.trim().slice(0, 100)
      : "";
    response.json(analytics.filterOptions(search));
  });
  router.get("/changesets", async (request, response, next) => {
    try {
      const result = await analytics.changesets(parseChangesetQuery(request.query));
      const meta = (result as { readonly meta: { readonly collaborationQueryMs: number; readonly productEnrichmentMs: number; readonly totalServerMs: number } }).meta;
      response.setHeader(
        "Server-Timing",
        `collaboration;dur=${meta.collaborationQueryMs}, enrichment;dur=${meta.productEnrichmentMs}, total;dur=${meta.totalServerMs}`
      );
      response.json(result);
    } catch (error) {
      next(error);
    }
  });

  router.get("/members", (request, response) => {
    response.json({ members: observation.listMembers(request.headers.cookie) });
  });
  router.post(
    "/members",
    json({ limit: "4kb" }),
    async (request, response, next) => {
      try {
        const member = await observation.addMember(
          request.headers.cookie,
          request.body?.githubLogin
        );
        response.status(201).json({ member });
      } catch (error) {
        next(error);
      }
    }
  );
  router.delete("/members/:githubUserId", (request, response) => {
    observation.removeMember(request.headers.cookie, request.params.githubUserId);
    response.status(204).end();
  });
  router.get("/access-events", (request, response) => {
    const rawLimit = typeof request.query.limit === "string" ? Number(request.query.limit) : 100;
    response.json({ events: observation.listEvents(request.headers.cookie, Number.isSafeInteger(rawLimit) ? rawLimit : 100) });
  });

  return router;
}

function setOAuthCookie(
  response: Parameters<Router["get"]>[1] extends (...args: infer A) => unknown ? A[1] : never,
  observation: ObservationModule,
  value: string,
  secure: boolean
): void {
  response.cookie(observation.oauthCookieName, value, {
    httpOnly: true,
    sameSite: "lax",
    secure,
    path: "/",
    maxAge: 10 * 60 * 1_000,
  });
}

function parseChangesetQuery(raw: Record<string, unknown>): ChangesetQuery {
  const now = Date.now();
  const to = parseDate(raw.to, now, "to");
  const from = parseDate(raw.from, to - 60 * 60 * 1_000, "from");
  if (from >= to) throw new ApplicationError("INVALID_INPUT", 400, "from must be before to.", "from");
  if (to - from > MAX_RANGE_MS) throw new ApplicationError("INVALID_INPUT", 400, "Changeset range cannot exceed 30 days.", "from");
  const scope = raw.scope === undefined ? "all" : raw.scope;
  if (scope !== "all" && scope !== "trunk" && scope !== "worktree") {
    throw new ApplicationError("INVALID_INPUT", 400, "Changeset scope is invalid.", "scope");
  }
  const measure = raw.measure === undefined ? "changesetCount" : raw.measure;
  if (measure !== "changesetCount" && measure !== "mutationCount" && measure !== "mutationSize") {
    throw new ApplicationError("INVALID_INPUT", 400, "Changeset measure is invalid.", "measure");
  }
  return {
    from,
    to,
    userId: optionalText(raw.userId),
    unitId: optionalText(raw.unitId),
    scope: scope as ChangesetScope,
    measure: measure as ChangesetMeasure,
  };
}

function parseDate(value: unknown, fallback: number, field: string): number {
  if (value === undefined) return fallback;
  if (typeof value !== "string") throw new ApplicationError("INVALID_INPUT", 400, `${field} is invalid.`, field);
  const numeric = /^\d+$/.test(value) ? Number(value) : Date.parse(value);
  if (!Number.isFinite(numeric)) throw new ApplicationError("INVALID_INPUT", 400, `${field} is invalid.`, field);
  return numeric;
}

function optionalText(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}
