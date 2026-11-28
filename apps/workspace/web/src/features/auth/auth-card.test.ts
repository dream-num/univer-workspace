// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LanguageProvider } from "../../shared/i18n";
import { AuthCard } from "./auth-card";
import { sessionQueryKey } from "./auth.queries";

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => vi.fn(),
}));

beforeEach(() => {
  vi.stubGlobal("window", {
    localStorage: { getItem: () => "en-US" },
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function renderAuthCard(returnTo?: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(sessionQueryKey, {
    authenticated: false,
    emailAuthEnabled: true,
    passwordAuthEnabled: true,
    githubOAuthEnabled: false,
    googleOAuthEnabled: false,
    discordOAuthEnabled: false,
  });
  return renderToStaticMarkup(
    createElement(
      QueryClientProvider,
      { client },
      createElement(LanguageProvider, null, createElement(AuthCard, returnTo ? { returnTo } : {})),
    ),
  );
}

describe("AuthCard subtitle", () => {
  it("shows resource-specific subtitle when returnTo starts with /nodes/ or /spaces/", () => {
    expect(renderAuthCard("/nodes/node-1?view=immersive")).toContain("Sign in to open this resource.");
    expect(renderAuthCard("/spaces/space-1")).toContain("Sign in to open this resource.");
  });

  it("keeps generic tagline when returnTo is absent or points elsewhere", () => {
    expect(renderAuthCard()).toContain("Collaborative editing, permissions, and AI tasks in one workspace.");
    expect(renderAuthCard("/home")).toContain("Collaborative editing, permissions, and AI tasks in one workspace.");
    expect(renderAuthCard("/claim/abc")).toContain("Collaborative editing, permissions, and AI tasks in one workspace.");
  });
});
