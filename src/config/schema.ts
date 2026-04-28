import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import { z } from "zod";

const CONFIG_PATH = path.join(os.homedir(), ".ai-assistant", "config.json");

export const TelegramConfigSchema = z.object({
  bot_token: z.string().default(""),
  allow_from: z.array(z.string()).default([]),
});

export const HeartbeatConfigSchema = z.object({
  enabled: z.boolean().default(true),
  interval: z.string().default("30m"),
  active_hours_start: z.string().default("09:00"),
  active_hours_end: z.string().default("22:00"),
  channel: z.string().default("telegram"),
  chat_id: z.string().default(""),
});

export const AppConfigSchema = z.object({
  telegram: TelegramConfigSchema.default({}),
  heartbeat: HeartbeatConfigSchema.default({}),
});

export type TelegramConfig = z.infer<typeof TelegramConfigSchema>;
export type HeartbeatConfig = z.infer<typeof HeartbeatConfigSchema>;
export type AppConfig = z.infer<typeof AppConfigSchema>;

const DEFAULT_CONFIG = {
  telegram: { bot_token: "", allow_from: [] as string[] },
  heartbeat: {
    enabled: true,
    interval: "30m",
    active_hours_start: "09:00",
    active_hours_end: "22:00",
    channel: "telegram",
    chat_id: "",
  },
};

const SETUP_INSTRUCTIONS = `
No Telegram bot token found. To set up:

  1. Message @BotFather on Telegram → /newbot → copy your token
  2. Find your Telegram user ID: message @userinfobot
  3. Edit ~/.ai-assistant/config.json:

     {
       "telegram": {
         "bot_token": "YOUR_BOT_TOKEN",
         "allow_from": ["YOUR_TELEGRAM_USER_ID"]
       },
       "heartbeat": {
         "chat_id": "YOUR_TELEGRAM_USER_ID"
       }
     }

  4. Re-run: npm run dev:gateway
`;

export async function loadConfig(): Promise<AppConfig> {
  let exists = true;
  try {
    await fs.access(CONFIG_PATH);
  } catch {
    exists = false;
  }

  if (!exists) {
    await fs.mkdir(path.dirname(CONFIG_PATH), { recursive: true });
    await fs.writeFile(CONFIG_PATH, JSON.stringify(DEFAULT_CONFIG, null, 2));
    console.log(`Created default config at ${CONFIG_PATH}`);
  }

  const raw = await fs.readFile(CONFIG_PATH, "utf8");
  const parsed = AppConfigSchema.parse(JSON.parse(raw));

  if (!parsed.telegram.bot_token) {
    console.log(SETUP_INSTRUCTIONS);
    process.exit(1);
  }

  return parsed;
}
