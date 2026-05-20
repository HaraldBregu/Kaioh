import OpenAI from "openai";
import type { ChatCompletion } from "openai/resources/chat/completions";
import type { ChatCompletionRequest, ChatModelProvider, OpenAIClientFactory, ProviderConfig } from "./base.js";

export class OpenAICompatibleProvider implements ChatModelProvider {
  readonly name: string;
  readonly defaultModel: string;
  private client: OpenAI;

  constructor(name: string, config: ProviderConfig, factory: OpenAIClientFactory = (opts) => new OpenAI(opts)) {
    const apiKey = process.env[config.apiKeyEnv];
    if (!apiKey) {
      throw new Error(`Missing API key environment variable '${config.apiKeyEnv}' for provider '${name}'.`);
    }

    this.name = name;
    this.defaultModel = config.defaultModel;
    this.client = factory({
      apiKey,
      baseURL: config.baseUrl,
      timeout: config.timeoutMs,
      maxRetries: config.maxRetries,
    });
  }

  async createChatCompletion(request: ChatCompletionRequest): Promise<ChatCompletion> {
    return await this.client.chat.completions.create({
      ...request,
      model: request.model ?? this.defaultModel,
    });
  }
}

