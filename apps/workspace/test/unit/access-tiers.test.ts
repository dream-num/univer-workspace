import { expect, it } from "vitest";
import { ACCESS_TIER_SCOPES } from "../../server/src/modules/identity/access-tokens.js";
import { accessTierScopes } from "../../web/src/features/account/access-tokens.rules";

it("gives each access tier the same scopes in the token dialog as on the connect page", () => {
  expect(accessTierScopes).toEqual(ACCESS_TIER_SCOPES);
});
