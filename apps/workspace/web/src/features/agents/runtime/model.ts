import { createDeepSeek } from "@ai-sdk/deepseek";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import type { LanguageModel } from "ai";
import type { AgentSession, ProviderKind, RunnableProvider } from "../agent.types";
import { validateProviderURL } from "../providers";

const modelFactories: Record<ProviderKind, (provider: RunnableProvider, modelId: string, request: typeof fetch) => LanguageModel> = {
  deepseek: (provider, modelId, request) => createDeepSeek({ apiKey: provider.apiKey, baseURL: provider.baseURL, fetch: request })(modelId),
  "openai-compatible": (provider, modelId, request) => createOpenAICompatible({ name: provider.id, apiKey: provider.apiKey, baseURL: provider.baseURL, fetch: request })(modelId),
};
export function createModel(provider: RunnableProvider, model: AgentSession["model"], request: typeof fetch, workspaceOrigin: string) {
  validateProviderURL(provider.baseURL, workspaceOrigin);
  if (!provider.models.includes(model.modelId)) throw new Error("Model is not configured for this provider");
  if (provider.kind !== "deepseek" && model.thinking !== null) throw new Error("Thinking options require a DeepSeek provider");
  const providerOrigin = new URL(provider.baseURL).origin;
  const providerFetch: typeof fetch = (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (url.origin !== providerOrigin) throw new Error("Model request escaped provider origin");
    return request(input, { ...init, credentials: "omit", redirect: "error" });
  };
  return {
    model: modelFactories[provider.kind](provider, model.modelId, providerFetch),
    providerOptions: provider.kind === "deepseek" && model.thinking !== null ? {
      deepseek: model.thinking === "off" ? { thinking: { type: "disabled" } } : { reasoningEffort: model.thinking },
    } : {},
  };
}
