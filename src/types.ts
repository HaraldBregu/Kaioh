export type AgentEventSource = "http" | "websocket" | "cron" | "heartbeat" | "channel";

export interface AgentEvent {
  id: string;
  agentId: string;
  source: AgentEventSource;
  conversationId?: string;
  userId?: string;
  text: string;
  metadata?: Record<string, unknown>;
  createdAt: string;
}

export interface ToolCallRecord {
  id: string;
  eventId?: string;
  agentId: string;
  conversationId?: string;
  toolName: string;
  args: Record<string, unknown>;
  result: string;
  startedAt: string;
  finishedAt: string;
  changedWorkspace: boolean;
  error?: string;
}

export interface AgentResponse {
  eventId: string;
  agentId: string;
  conversationId?: string;
  text: string;
  toolCalls?: ToolCallRecord[];
  createdAt: string;
}

export interface InboundMessage {
  channel: string;
  chat_id: string;
  sender_id?: string;
  text: string;
}

export class AsyncQueue<T> {
  private items: T[] = [];
  private resolvers: Array<(v: T) => void> = [];

  put(item: T): void {
    const r = this.resolvers.shift();
    if (r) r(item);
    else this.items.push(item);
  }

  get(): Promise<T> {
    const item = this.items.shift();
    if (item !== undefined) return Promise.resolve(item);
    return new Promise<T>((resolve) => this.resolvers.push(resolve));
  }
}
