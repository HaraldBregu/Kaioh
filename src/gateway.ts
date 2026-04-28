import { promises as fs } from "node:fs";
import path from "node:path";
import chalk from "chalk";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";

import { buildSystemPrompt } from "./agent/context.js";
import { runAgent } from "./agent/loop.js";
import { MemoryManager } from "./agent/memory.js";
import { TelegramAdapter } from "./channels/telegram.js";
import { loadConfig, type AppConfig } from "./config/schema.js";
import { CronService } from "./cron/service.js";
import { SessionManager } from "./session/manager.js";
import { CronAddTool, CronListTool, CronRemoveTool } from "./tools/cron.js";
import { ExecTool } from "./tools/exec.js";
import { ReadFileTool, WriteFileTool } from "./tools/filesystem.js";
import { AsyncQueue, type InboundMessage } from "./types.js";
import type { Tool } from "./tools/base.js";

const UNIT_MAP: Record<string, number> = { s: 1, m: 60, h: 3600 };

function parseTimeOfDay(s: string): { h: number; m: number } {
  const [h, m] = s.split(":").map((n) => parseInt(n, 10));
  return { h, m };
}

function isWithinActiveHours(now: Date, start: string, end: string): boolean {
  const s = parseTimeOfDay(start);
  const e = parseTimeOfDay(end);
  const cur = now.getHours() * 60 + now.getMinutes();
  const startMin = s.h * 60 + s.m;
  const endMin = e.h * 60 + e.m;
  return cur >= startMin && cur <= endMin;
}

async function messageLoop(
  queue: AsyncQueue<InboundMessage>,
  adapter: TelegramAdapter,
  tools: Tool[],
  memory: MemoryManager,
  stopSignal: { stopped: boolean },
): Promise<void> {
  // chat_id → message history (in-memory cache so we don't reload from disk per message)
  const sessions = new Map<string, ChatCompletionMessageParam[]>();

  while (!stopSignal.stopped) {
    const msg = await queue.get();
    if (msg.channel === "_shutdown") return;

    const chatId = msg.chat_id;
    const channel = msg.channel ?? "telegram";
    const senderId = msg.sender_id ?? "";
    const masked = String(chatId).slice(0, 3) + "***";
    console.log(`${chalk.bold.cyan(`[${channel}:${masked}]`)} ${msg.text}`);

    const session = new SessionManager(`${channel}:${chatId}`);
    await session.init();

    if (!sessions.has(chatId)) {
      sessions.set(chatId, await session.load());
    }
    const history = sessions.get(chatId)!;

    const systemPrompt = await buildSystemPrompt(memory, channel, chatId);

    let text = msg.text;
    if (senderId === "heartbeat" || senderId === "cron") {
      text = `[Automated ${senderId} — act on these instructions, do not describe them]\n\n${text}`;
    }

    const { text: response, newMessages } = await runAgent(text, tools, history, systemPrompt);

    await session.append(newMessages);
    history.push(...newMessages);

    if ((senderId === "heartbeat" || senderId === "cron") && response.trim().startsWith("HEARTBEAT_OK")) {
      continue;
    }

    await adapter.send(chatId, response);
  }
}

async function heartbeatLoop(
  queue: AsyncQueue<InboundMessage>,
  memory: MemoryManager,
  config: AppConfig,
  stopSignal: { stopped: boolean },
): Promise<void> {
  const hb = config.heartbeat;
  if (!hb.enabled || !hb.chat_id) return;

  const unit = hb.interval.slice(-1);
  const n = parseInt(hb.interval.slice(0, -1), 10);
  const intervalMs = n * UNIT_MAP[unit] * 1000;

  while (!stopSignal.stopped) {
    await new Promise((r) => setTimeout(r, intervalMs));
    if (stopSignal.stopped) return;

    if (!isWithinActiveHours(new Date(), hb.active_hours_start, hb.active_hours_end)) continue;

    const heartbeatPath = path.join(memory.workspace, "HEARTBEAT.md");
    let text: string;
    try {
      text = (await fs.readFile(heartbeatPath, "utf8")).trim();
    } catch {
      continue;
    }
    if (!text) continue;

    queue.put({
      channel: hb.channel,
      chat_id: hb.chat_id,
      sender_id: "heartbeat",
      text,
    });
  }
}

async function main(): Promise<void> {
  if (!process.env.OPENROUTER_API_KEY) {
    console.error("Error: OPENROUTER_API_KEY env var not set");
    process.exit(1);
  }

  const config = await loadConfig();

  const memory = new MemoryManager();
  await memory.init();

  // shared queue — telegram, heartbeat, and cron all push into this
  const inbound = new AsyncQueue<InboundMessage>();

  const cron = new CronService(inbound);
  await cron.load();

  const tools: Tool[] = [
    new ReadFileTool(),
    new WriteFileTool(),
    new ExecTool(),
    new CronAddTool(cron),
    new CronListTool(cron),
    new CronRemoveTool(cron),
  ];

  const adapter = new TelegramAdapter({
    bot_token: config.telegram.bot_token,
    allow_from: config.telegram.allow_from,
    queue: inbound,
  });
  await adapter.start();
  console.log("Gateway running. Press Ctrl+C to stop.");

  const stopSignal = { stopped: false };
  const messageTask = messageLoop(inbound, adapter, tools, memory, stopSignal);
  const heartbeatTask = heartbeatLoop(inbound, memory, config, stopSignal);
  const cronTask = cron.run();

  const shutdown = async () => {
    console.log("\nShutting down...");
    stopSignal.stopped = true;
    cron.stop();
    // unblock messageLoop's pending queue.get() with a sentinel
    inbound.put({ channel: "_shutdown", chat_id: "_shutdown", text: "" });
    await adapter.stop();
    console.log("Done.");
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  await Promise.all([messageTask, heartbeatTask, cronTask]);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
