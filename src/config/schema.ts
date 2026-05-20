import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { z } from "zod";
import { DEFAULT_WORKSPACE_ROOT } from "../workspace/manager.js";

const CONFIG_PATH = path.join(os.homedir(), ".ai-assistant", "config.json");

export const GatewayConfigSchema = z.object({
  host: z.string().default("127.0.0.1"),
  port: z.number().int().min(1).max(65535).default(8787),
  auth_token_env: z.string().default("KAIOH_GATEWAY_TOKEN"),
  allow_unauthenticated_localhost: z.boolean().default(true),
});

export const TelegramConfigSchema = z.object({
  enabled: z.boolean().default(false),
  bot_token: z.string().default(""),
  allow_from: z.array(z.string()).default([]),
  agent_id: z.string().default("default"),
});

export const HeartbeatConfigSchema = z.object({
  enabled: z.boolean().default(true),
  interval: z.string().default("30m"),
  active_hours_start: z.string().default("09:00"),
  active_hours_end: z.string().default("22:00"),
  agent_id: z.string().default("default"),
  channel: z.string().default("telegram"),
  chat_id: z.string().default(""),
  prompt_file: z.string().default("memory/HEARTBEAT.md"),
});

export const ProviderConfigSchema = z.object({
  type: z.enum(["openai", "openai-compatible"]).default("openai-compatible"),
  baseUrl: z.string().url().optional(),
  apiKeyEnv: z.string().default("OPENROUTER_API_KEY"),
  defaultModel: z.string().default("gpt-5.4"),
  timeoutMs: z.number().int().positive().optional(),
  maxRetries: z.number().int().min(0).optional(),
});

export const ModelsConfigSchema = z.object({
  defaultProvider: z.string().default("openrouter"),
  providers: z
    .record(ProviderConfigSchema)
    .default({
      openrouter: {
        type: "openai-compatible",
        baseUrl: "https://openrouter.ai/api/v1",
        apiKeyEnv: "OPENROUTER_API_KEY",
        defaultModel: "gpt-5.4",
      },
      openai: {
        type: "openai",
        apiKeyEnv: "OPENAI_API_KEY",
        defaultModel: "gpt-5.4",
      },
    }),
});

export const ToolConfigSchema = z.object({
  enable_exec: z.boolean().default(false),
});

export const SkillDefinitionSchema = z.object({
  name: z.string(),
  description: z.string().default(""),
  version: z.string().default("1.0.0"),
  activationRules: z.array(z.string()).default([]),
  instructions: z.string(),
  requiredTools: z.array(z.string()).default([]),
  configSchema: z.record(z.unknown()).optional(),
});

export const SkillsConfigSchema = z.object({
  enabled: z.array(z.string()).default([]),
  definitions: z.array(SkillDefinitionSchema).default([]),
});

export const AgentConfigSchema = z.object({
  model_provider: z.string().optional(),
  model: z.string().optional(),
  enabled_tools: z.array(z.string()).optional(),
  enabled_skills: z.array(z.string()).optional(),
});

export const WorkspaceConfigSchema = z.object({
  root: z.string().default(DEFAULT_WORKSPACE_ROOT),
});

export const CronConfigSchema = z.object({
  enabled: z.boolean().default(true),
  poll_interval_ms: z.number().int().positive().default(10_000),
});

export const LoggingConfigSchema = z.object({
  retention_days: z.number().int().positive().default(30),
});

export const AppConfigSchema = z.object({
  gateway: GatewayConfigSchema.default({}),
  telegram: TelegramConfigSchema.default({}),
  heartbeat: HeartbeatConfigSchema.default({}),
  models: ModelsConfigSchema.default({}),
  tools: ToolConfigSchema.default({}),
  skills: SkillsConfigSchema.default({}),
  agents: z.record(AgentConfigSchema).default({ default: {} }),
  workspace: WorkspaceConfigSchema.default({}),
  cron: CronConfigSchema.default({}),
  logging: LoggingConfigSchema.default({}),
});

export type GatewayConfig = z.infer<typeof GatewayConfigSchema>;
export type TelegramConfig = z.infer<typeof TelegramConfigSchema>;
export type HeartbeatConfig = z.infer<typeof HeartbeatConfigSchema>;
export type AppConfig = z.infer<typeof AppConfigSchema>;

const DEFAULT_CONFIG: AppConfig = AppConfigSchema.parse({});

export async function loadConfig(): Promise<AppConfig> {
  let exists = true;
  try {
    await fs.access(CONFIG_PATH);
  } catch {
    exists = false;
  }

  if (!exists) {
    await fs.mkdir(path.dirname(CONFIG_PATH), { recursive: true });
    await fs.writeFile(CONFIG_PATH, JSON.stringify(DEFAULT_CONFIG, null, 2), "utf8");
    console.log(`Created default config at ${CONFIG_PATH}`);
  }

  const raw = await fs.readFile(CONFIG_PATH, "utf8");
  const parsed = AppConfigSchema.parse(JSON.parse(raw));

  await fs.writeFile(CONFIG_PATH, JSON.stringify(parsed, null, 2), "utf8");
  return parsed;
}

