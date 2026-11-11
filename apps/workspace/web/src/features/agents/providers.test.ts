import { describe, expect, it, vi } from "vitest";
import { providerIdSchema } from "./agent.types";
import { createProviders, deepSeekDefault } from "./providers";
import { storageOptions, TestStorage } from "./test-helpers";

function setup() {
  return { ...storageOptions(), fetch: vi.fn<typeof fetch>(), workspaceOrigin: "https://workspace.test" };
}
describe("provider configurations and keys", () => {
  it("exposes DeepSeek by default and remembers keys across instances", async () => {
    const options = setup();
    const providers = createProviders(options);
    expect(await providers.list()).toEqual([deepSeekDefault]);
    await providers.setKey(deepSeekDefault.id, "secret");
    expect((await createProviders({ ...options, storage: new TestStorage() }).resolve(deepSeekDefault.id)).apiKey).toBe("secret");
  });

  it("remember off removes persisted keys and keeps only per-user tab storage", async () => {
    const options = setup();
    const providers = createProviders(options);
    await providers.setKey(deepSeekDefault.id, "old-secret");
    await providers.setKey(deepSeekDefault.id, "tab-secret", false);
    expect((await createProviders(options).resolve(deepSeekDefault.id)).apiKey).toBe("tab-secret");
    await expect(createProviders({ ...options, storage: new TestStorage() }).resolve(deepSeekDefault.id)).rejects.toThrow("No API key");
    await expect(createProviders({ ...options, userId: "user-b" }).resolve(deepSeekDefault.id)).rejects.toThrow("No API key");
    expect(options.storage.key(0)).toMatch(/^univer-workspace-/);
  });

  it("clear-all removes remembered and temporary keys for just this user", async () => {
    const options = setup();
    const providers = createProviders(options);
    const other = { ...deepSeekDefault, id: providerIdSchema.parse("other") };
    await providers.save(other);
    await providers.setKey(other.id, "remembered");
    await providers.setKey(deepSeekDefault.id, "temporary", false);
    const anotherUser = createProviders({ ...options, userId: "user-b" });
    await anotherUser.setKey(deepSeekDefault.id, "other-user", false);
    await providers.clearAllKeys();
    await expect(providers.resolve(deepSeekDefault.id)).rejects.toThrow("No API key");
    await expect(createProviders(options).resolve(other.id)).rejects.toThrow("No API key");
    expect((await anotherUser.resolve(deepSeekDefault.id)).apiKey).toBe("other-user");
  });

  it("saves configs without keys, removes configs and clears their keys", async () => {
    const options = setup();
    const providers = createProviders(options);
    const config = { ...deepSeekDefault, id: providerIdSchema.parse("custom"), kind: "openai-compatible" as const };
    await providers.save(config);
    await providers.setKey(config.id, "secret");
    expect((await providers.list()).find((value) => value.id === config.id)).toEqual(config);
    await providers.remove(config.id);
    expect(await providers.list()).toEqual([deepSeekDefault]);
    await providers.save(config);
    await expect(providers.resolve(config.id)).rejects.toThrow("No API key");
    await providers.setKey(config.id, "secret");
    await providers.clearKey(config.id);
    await expect(providers.resolve(config.id)).rejects.toThrow("No API key");
  });

  it("tests connections and redacts keys from provider errors", async () => {
    const options = setup();
    const providers = createProviders(options);
    await providers.setKey(deepSeekDefault.id, "secret");
    options.fetch.mockResolvedValueOnce(new Response("{}"));
    expect(await providers.testConnection(deepSeekDefault.id)).toEqual({ ok: true, status: 200, message: "Connected" });
    expect(options.fetch).toHaveBeenCalledWith("https://api.deepseek.com/models", expect.objectContaining({ headers: { Authorization: "Bearer secret" } }));
    options.fetch.mockResolvedValueOnce(new Response("Invalid secret", { status: 401 }));
    expect(await providers.testConnection(deepSeekDefault.id)).toEqual({ ok: false, status: 401, message: "Invalid [redacted]" });
    options.fetch.mockRejectedValueOnce(new Error("secret rejected"));
    expect((await providers.testConnection(deepSeekDefault.id)).message).toBe("[redacted] rejected");
  });

  it("rejects Workspace URLs before sending a provider key", async () => {
    const options = setup();
    const providers = createProviders(options);
    await expect(providers.save({ ...deepSeekDefault, baseURL: "https://workspace.test/api" })).rejects.toThrow("external HTTP");
    await expect(providers.save({ ...deepSeekDefault, baseURL: "javascript:alert(1)" })).rejects.toThrow("external HTTP");
    expect(options.fetch).not.toHaveBeenCalled();
  });
});
