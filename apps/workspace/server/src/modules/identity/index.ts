export { ANONYMOUS_USER_ID } from "./anonymous-user.js";
export { createIdentityModule } from "./identity.service.js";
export type { IdentityModule } from "./identity.service.js";
export type {
  AuthenticatedSession,
  Principal,
  SessionView,
  User,
} from "./identity.types.js";
export { IdentityRepository } from "./identity.repository.js";
export { createIdentityRouter } from "./identity.router.js";
export { createGitHubOAuthProvider } from "./github-oauth.js";
export { createDiscordOAuthProvider } from "./discord-oauth.js";
export { createGoogleOAuthProvider } from "./google-oauth.js";
export { createMcpClientRegistrationHandler, createOAuthAuthorizationRouter } from "./oauth-authorization-router.js";
export type {
  IssuedAuthorization,
  OAuthClientConfig,
} from "./oauth-clients.js";
export type {
  DiscordOAuthProvider,
  GitHubOAuthProvider,
  GoogleOAuthProvider,
} from "./identity.types.js";
export { writeSourceView, type WriteSource, type WriteSourceView } from "./write-source.js";
export { createAccessTokenService } from "./access-tokens.js";
export type { AccessTokenService, McpScope } from "./access-tokens.js";
export { authorizationServerMetadata, type McpOAuthConfig } from "./mcp-oauth.js";
