export { createIdentityModule } from "./identity.service.js";
export type { IdentityModule } from "./identity.service.js";
export type {
  AuthenticatedSession,
  SessionView,
  User,
} from "./identity.types.js";
export { IdentityRepository } from "./identity.repository.js";
export { createIdentityRouter } from "./identity.router.js";
export { createGitHubOAuthProvider } from "./github-oauth.js";
export { createDiscordOAuthProvider } from "./discord-oauth.js";
export { createOAuthAuthorizationRouter } from "./oauth-authorization-router.js";
export type {
  IssuedAuthorization,
  OAuthClientConfig,
} from "./oauth-clients.js";
export type {
  DiscordOAuthProvider,
  GitHubOAuthProvider,
} from "./identity.types.js";
