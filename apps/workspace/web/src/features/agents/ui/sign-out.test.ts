import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, it, vi } from "vitest";
import { AccountMenu } from "../../account/account-menu";
import { AgentAccountDialog } from "./model-settings";

const state = vi.hoisted(() => ({
  effects: [] as (() => void)[], values: [] as unknown[], cursor: 0,
  clicks: new Map<string, () => void>(),
  load: vi.fn(), configured: vi.fn(), stopAll: vi.fn(), clearAllKeys: vi.fn(),
}));
vi.mock("react", async (original) => ({
  ...await original<typeof import("react")>(),
  useEffect: (effect: () => void) => { state.effects.push(effect); },
  useState: (initial: unknown) => {
    const index = state.cursor++;
    if (!(index in state.values)) state.values[index] = initial;
    return [state.values[index], (value: unknown) => { state.values[index] = value; }];
  },
}));
vi.mock("../index", () => ({ loadAgentsUi: () => state.load() }));
vi.mock("./client", () => ({
  configuredProviders: () => state.configured(),
  useAgentClient: () => ({ stopAll: state.stopAll, providers: { clearAllKeys: state.clearAllKeys } }),
}));
vi.mock("../../../shared/i18n", () => ({ useI18n: () => ({ language: "en-US", t: (key: string) => key }) }));
vi.mock("../../../shared/ui", () => {
  const Box = ({ children }: { children?: ReactNode }) => createElement("div", null, children);
  return { MenuRoot: Box, MenuTrigger: Box, MenuContent: Box, MenuGroup: Box, MenuSeparator: () => null, Avatar: () => null,
    MenuItem: ({ children, onClick }: { children?: ReactNode; onClick: () => void }) => {
      state.clicks.set(renderToStaticMarkup(createElement("span", null, children)).replace(/<[^>]*>/g, ""), onClick);
      return createElement("button", null, children);
    } };
});
vi.mock("../../../shared/ui/dialog", () => ({
  Dialog: ({ children, footer, description }: { children?: ReactNode; footer?: ReactNode; description: string }) => createElement("div", { role: "dialog" }, description, children, footer),
}));
vi.mock("../../../shared/ui/button", () => ({
  Button: ({ children, onClick }: { children?: ReactNode; onClick: () => void }) => {
    state.clicks.set(String(children), onClick);
    return createElement("button", null, children);
  },
}));

beforeEach(() => {
  state.effects = []; state.values = []; state.cursor = 0; state.clicks.clear();
  state.load.mockReset(); state.configured.mockReset();
  state.stopAll.mockReset().mockResolvedValue(undefined);
  state.clearAllKeys.mockReset().mockResolvedValue(undefined);
});

it("signs out if the lazy Agents UI cannot load", async () => {
  state.load.mockRejectedValue(new Error("Chunk unavailable"));
  const onLogout = vi.fn();
  renderToStaticMarkup(createElement(AccountMenu, {
    currentSession: { authenticated: true, githubOAuthEnabled: false, googleOAuthEnabled: false,
      discordOAuthEnabled: false, passwordAuthEnabled: false, emailAuthEnabled: false, trialDeployment: false,
      user: { id: "user-a", username: "ada", displayName: "Ada", avatarUrl: null },
      authenticationMethods: { password: false, email: null, externalIdentities: [] } },
    onProfile: vi.fn(), onPassword: vi.fn(), onAccessTokens: vi.fn(), extraItems: null, logoutPending: false, onLogout,
  }));
  state.clicks.get("signOut")!();
  await vi.waitFor(() => expect(onLogout).toHaveBeenCalledOnce());
});

it("signs out directly when reading saved keys fails", async () => {
  state.configured.mockRejectedValue(new Error("Storage unavailable"));
  const onLogout = vi.fn();
  const onClose = vi.fn();
  renderToStaticMarkup(createElement(AgentAccountDialog, { action: "logout", onClose, onLogout }));
  state.effects.splice(0).forEach((effect) => effect());
  await vi.waitFor(() => expect(onLogout).toHaveBeenCalledOnce());
  expect(onClose).toHaveBeenCalledOnce();
});

it("keeps the key confirmation dialog and waits for confirmation when keys are readable", async () => {
  state.configured.mockResolvedValue([{ id: "provider" }]);
  const onLogout = vi.fn();
  const onClose = vi.fn();
  const render = () => {
    state.cursor = 0;
    return renderToStaticMarkup(createElement(AgentAccountDialog, { action: "logout", onClose, onLogout }));
  };
  render();
  state.effects.splice(0).forEach((effect) => effect());
  await vi.waitFor(() => expect(render()).toContain("Choose whether to remove them"));
  expect(onLogout).not.toHaveBeenCalled();
  expect(state.stopAll).not.toHaveBeenCalled();
  expect(render()).toContain('type="checkbox"');
  state.clicks.get("Sign out")!();
  await vi.waitFor(() => expect(onLogout).toHaveBeenCalledOnce());
  expect(state.stopAll).toHaveBeenCalledOnce();
  expect(state.clearAllKeys).not.toHaveBeenCalled();
});
