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
