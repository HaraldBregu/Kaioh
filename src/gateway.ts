import { promises as fs } from "node:fs";
import { randomUUID } from "node:crypto";
import { loadConfig, type AppConfig } from "./config/schema.js";
import { CronService } from "./cron/service.js";
import { GatewayServer } from "./http/gateway-server.js";
import { createProviderRegistry } from "./providers/factory.js";
import { AgentRuntime, workspaceCronPath } from "./runtime/agent-runtime.js";
import { TelegramAdapter } from "./channels/telegram.js";
import { AsyncQueue, type AgentEvent } from "./types.js";
import { WorkspaceManager } from "./workspace/manager.js";

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

function parseIntervalMs(value: string): number {
  const unit = value.slice(-1);
  const n = parseInt(value.slice(0, -1), 10);
  if (!Number.isFinite(n) || !UNIT_MAP[unit]) {
    throw new Error(`Invalid interval '${value}'. Use values like '30m', '1h', or '60s'.`);
  }
  return n * UNIT_MAP[unit] * 1000;
}

async function processQueue(
  queue: AsyncQueue<AgentEvent>,
  runtime: AgentRuntime,
  telegram: TelegramAdapter | undefined,
  stopSignal: { stopped: boolean },
): Promise<void> {
  while (!stopSignal.stopped) {
    const event = await queue.get();
    if (event.metadata?.shutdown) return;

    try {
      const response = await runtime.handleEvent(event);
      if ((event.source === "heartbeat" || event.source === "cron") && response.text.trim().startsWith("HEARTBEAT_OK")) {
        continue;
      }

      const channel = typeof event.metadata?.channel === "string" ? event.metadata.channel : undefined;
      const chatId = typeof event.metadata?.chat_id === "string" ? event.metadata.chat_id : undefined;
      if (channel === "telegram" && chatId && telegram) {
        await telegram.send(chatId, response.text);
        continue;
      }

      console.log(`[${event.source}:${event.agentId}] ${response.text}`);
    } catch (e) {
      console.error(`Failed to process event ${event.id}:`, e);
    }
  }
}

async function heartbeatLoop(
  queue: AsyncQueue<AgentEvent>,
  workspaceManager: WorkspaceManager,
  config: AppConfig,
  stopSignal: { stopped: boolean },
): Promise<void> {
  const hb = config.heartbeat;
  if (!hb.enabled) return;

  const intervalMs = parseIntervalMs(hb.interval);
  while (!stopSignal.stopped) {
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
    if (stopSignal.stopped) return;
    if (!isWithinActiveHours(new Date(), hb.active_hours_start, hb.active_hours_end)) continue;

    const workspace = await workspaceManager.initAgent(hb.agent_id);
    let text: string;
    try {
      const promptPath = await workspaceManager.resolvePath(workspace, hb.prompt_file, { mustExist: true });
      text = (await fs.readFile(promptPath, "utf8")).trim();
    } catch {
      continue;
    }
    if (!text) continue;

    queue.put({
      id: randomUUID(),
      agentId: hb.agent_id,
      source: "heartbeat",
      conversationId: `heartbeat:${hb.channel}:${hb.chat_id || hb.agent_id}`,
      userId: "heartbeat",
      text,
      metadata: {
        channel: hb.channel,
        chat_id: hb.chat_id,
      },
      createdAt: new Date().toISOString(),
    });
  }
}

async function main(): Promise<void> {
  const config = await loadConfig();
  const workspaceManager = new WorkspaceManager(config.workspace.root);
  const providers = createProviderRegistry(config.models);
  const inbound = new AsyncQueue<AgentEvent>();
  const cron = new CronService(inbound, workspaceCronPath(config.workspace.root), config.cron.poll_interval_ms);
  await cron.load();

  const runtime = new AgentRuntime({
    config,
    workspaceManager,
    providers,
    cron,
  });

  let telegram: TelegramAdapter | undefined;
  if (config.telegram.enabled) {
    if (!config.telegram.bot_token) {
      console.warn("Telegram is enabled but telegram.bot_token is empty; Telegram adapter was not started.");
    } else {
      telegram = new TelegramAdapter({
        bot_token: config.telegram.bot_token,
        allow_from: config.telegram.allow_from,
        queue: inbound,
        agent_id: config.telegram.agent_id,
      });
      await telegram.start();
      console.log("Telegram adapter running.");
    }
  }

  const server = new GatewayServer(config.gateway, runtime, cron);
  await server.start();
  console.log(`Gateway API running at ${server.address()}`);
  console.log(`WebSocket endpoint: ${server.address()}/api/ws`);

  const stopSignal = { stopped: false };
  const queueTask = processQueue(inbound, runtime, telegram, stopSignal);
  const heartbeatTask = heartbeatLoop(inbound, workspaceManager, config, stopSignal);
  const cronTask = config.cron.enabled ? cron.run() : Promise.resolve();

  const shutdown = async () => {
    console.log("\nShutting down...");
    stopSignal.stopped = true;
    cron.stop();
    inbound.put({
      id: "shutdown",
      agentId: "system",
      source: "channel",
      text: "",
      metadata: { shutdown: true },
      createdAt: new Date().toISOString(),
    });
    await telegram?.stop();
    await server.stop();
    console.log("Done.");
    process.exit(0);
  };

  process.on("SIGINT", () => void shutdown());
  process.on("SIGTERM", () => void shutdown());

  await Promise.all([queueTask, heartbeatTask, cronTask]);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

