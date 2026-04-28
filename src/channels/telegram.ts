import { Bot } from "grammy";
import type { AsyncQueue, InboundMessage } from "../types.js";

const TELEGRAM_MAX_LENGTH = 4096;

export class TelegramAdapter {
  private bot: Bot;
  private allowFrom: Set<string>;
  private queue: AsyncQueue<InboundMessage>;

  constructor(opts: {
    bot_token: string;
    allow_from: string[];
    queue: AsyncQueue<InboundMessage>;
  }) {
    this.bot = new Bot(opts.bot_token);
    this.allowFrom = new Set(opts.allow_from.map(String));
    this.queue = opts.queue;

    // plain text only — no commands, photos, stickers, etc.
    this.bot.on("message:text", async (ctx) => {
      const text = ctx.message.text;
      if (!text || text.startsWith("/")) return;

      const senderId = String(ctx.from?.id ?? "");
      if (this.allowFrom.size > 0 && !this.allowFrom.has(senderId)) {
        console.warn(`Ignored message from unauthorized user ${senderId}`);
        return;
      }

      this.queue.put({
        channel: "telegram",
        chat_id: String(ctx.chat.id),
        sender_id: senderId,
        text,
      });
    });
  }

  async send(chatId: string, text: string): Promise<void> {
    let remaining = text;
    while (remaining.length > 0) {
      const chunk = remaining.slice(0, TELEGRAM_MAX_LENGTH);
      remaining = remaining.slice(TELEGRAM_MAX_LENGTH);
      await this.bot.api.sendMessage(chatId, chunk);
    }
  }

  async start(): Promise<void> {
    // start polling without awaiting (start() resolves only on stop)
    this.bot.start({ drop_pending_updates: true }).catch((e) => {
      console.error("Telegram polling error:", e);
    });
    // give grammy a tick to init
    await new Promise((r) => setTimeout(r, 100));
  }

  async stop(): Promise<void> {
    await this.bot.stop();
  }
}
