import { ProviderRegistry, type ModelProviderConfig } from "./base.js";
import { OpenAICompatibleProvider } from "./openai-compatible.js";

export function createProviderRegistry(config: ModelProviderConfig): ProviderRegistry {
  const registry = new ProviderRegistry();

  for (const [name, providerConfig] of Object.entries(config.providers)) {
    if (providerConfig.type === "openai" || providerConfig.type === "openai-compatible") {
      registry.registerFactory(name, () => new OpenAICompatibleProvider(name, providerConfig));
      continue;
    }

    const _exhaustive: never = providerConfig.type;
    throw new Error(`Unsupported provider type '${_exhaustive}'.`);
  }

  return registry;
}
