import OpenAI from "openai";
import type { ChatCompletion } from "openai/resources/chat/completions";
import type { ChatCompletionRequest, ChatModelProvider, OpenAIClientFactory, ProviderConfig, StreamDelta } from "./base.js";

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

  async *createChatCompletionStream(request: ChatCompletionRequest): AsyncGenerator<StreamDelta> {
    const stream = await this.client.chat.completions.create({
      ...request,
      model: request.model ?? this.defaultModel,
      stream: true,
    });
    for await (const chunk of stream) {
      const choice = chunk.choices[0];
      if (!choice) continue;
      const delta: StreamDelta = { finishReason: choice.finish_reason };
      if (choice.delta.content) delta.content = choice.delta.content;
      if (choice.delta.tool_calls?.length) {
        delta.toolCallDeltas = choice.delta.tool_calls.map((tc) => ({
          index: tc.index,
          id: tc.id,
          name: tc.function?.name,
          args: tc.function?.arguments,
        }));
      }
      yield delta;
    }
  }
}

