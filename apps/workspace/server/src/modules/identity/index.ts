export { ANONYMOUS_USER_ID } from "./anonymous-user.js";
export { createIdentityModule } from "./identity.service.js";
export { createAgentClaims, type AgentClaims } from "./agent-claims.js";
export type { IdentityModule } from "./identity.service.js";
export type {
  AuthenticatedSession,
  Principal,
  PrincipalCategory,
  PrincipalKind,
  PrincipalUser,
  SessionView,
  User,
} from "./identity.types.js";
export { principalCategory } from "./principal-category.js";
export { createSourceRateLimiter } from "./source-rate-limiter.js";
export type { IdentityRepository } from "./identity.repository.js";
export { createIdentityRouter } from "./identity.router.js";
export { createGitHubOAuthProvider } from "./github-oauth.js";
export { createDiscordOAuthProvider } from "./discord-oauth.js";
export { createGoogleOAuthProvider } from "./google-oauth.js";
export { createGuestAuthorizationCheck, createMcpClientRegistrationHandler, createOAuthAuthorizationRouter } from "./oauth-authorization-router.js";
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
export type { AccessTokenRepository } from "./access-token.repository.js";
