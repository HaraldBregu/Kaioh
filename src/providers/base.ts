import type OpenAI from "openai";
import type { ChatCompletion, ChatCompletionCreateParamsNonStreaming } from "openai/resources/chat/completions";

export type ChatCompletionRequest = Omit<ChatCompletionCreateParamsNonStreaming, "model"> & {
  model?: string;
};

export interface StreamDelta {
  content?: string;
  toolCallDeltas?: Array<{
    index: number;
    id?: string;
    name?: string;
    args?: string;
  }>;
  finishReason?: string | null;
}

export interface ChatModelProvider {
  name: string;
  defaultModel: string;
  createChatCompletion(request: ChatCompletionRequest): Promise<ChatCompletion>;
  createChatCompletionStream?(request: ChatCompletionRequest): AsyncGenerator<StreamDelta>;
}

export interface ProviderConfig {
  type: "openai" | "openai-compatible";
  baseUrl?: string;
  apiKeyEnv: string;
  defaultModel: string;
  timeoutMs?: number;
  maxRetries?: number;
}

export interface ModelProviderConfig {
  defaultProvider: string;
  providers: Record<string, ProviderConfig>;
}

export class ProviderRegistry {
  private providers = new Map<string, ChatModelProvider | (() => ChatModelProvider)>();

  register(provider: ChatModelProvider): void {
    this.providers.set(provider.name, provider);
  }

  registerFactory(name: string, factory: () => ChatModelProvider): void {
    this.providers.set(name, factory);
  }

  get(name: string): ChatModelProvider {
    const entry = this.providers.get(name);
    if (!entry) {
      throw new Error(`Model provider '${name}' is not configured.`);
    }

    if (typeof entry === "function") {
      const provider = entry();
      this.providers.set(name, provider);
      return provider;
    }

    const provider = entry;
    return provider;
  }
}

export type OpenAIClientFactory = (opts: {
  apiKey: string;
  baseURL?: string;
  timeout?: number;
  maxRetries?: number;
}) => OpenAI;
