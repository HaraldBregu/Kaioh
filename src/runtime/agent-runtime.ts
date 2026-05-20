import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { buildSystemPrompt } from "../agent/context.js";
import { runAgent, type RunAgentCallbacks } from "../agent/loop.js";
import { AuditLogger } from "../audit/logger.js";
import type { AppConfig } from "../config/schema.js";
import type { CronService } from "../cron/service.js";
import type { ProviderRegistry } from "../providers/base.js";
import { SessionManager } from "../session/manager.js";
import { SkillRegistry } from "../skills/registry.js";
import { CronAddTool, CronListTool, CronRemoveTool } from "../tools/cron.js";
import { ExecTool } from "../tools/exec.js";
import {
  CreateDirectoryTool,
  DeleteFileTool,
  ListFilesTool,
  MoveFileTool,
  ReadFileTool,
  WriteFileTool,
} from "../tools/filesystem.js";
import type { Tool } from "../tools/base.js";
import type { AgentEvent, AgentResponse } from "../types.js";
import { WorkspaceManager } from "../workspace/manager.js";

export interface AgentRuntimeOptions {
  config: AppConfig;
  workspaceManager: WorkspaceManager;
  providers: ProviderRegistry;
  cron?: CronService;
}

export interface HandleEventOptions {
  callbacks?: RunAgentCallbacks;
}

function metadataString(value: unknown): string | undefined {
  return typeof value === "string" && value ? value : undefined;
}

export class AgentRuntime {
  private config: AppConfig;
  private workspaceManager: WorkspaceManager;
  private providers: ProviderRegistry;
  private cron?: CronService;

  constructor(options: AgentRuntimeOptions) {
    this.config = options.config;
    this.workspaceManager = options.workspaceManager;
    this.providers = options.providers;
    this.cron = options.cron;
  }

  async handleEvent(event: AgentEvent, options: HandleEventOptions = {}): Promise<AgentResponse> {
    const workspace = await this.workspaceManager.initAgent(event.agentId);
    const audit = new AuditLogger(workspace);
    await audit.event({
      event_id: event.id,
      agent_id: event.agentId,
      source: event.source,
      conversation_id: event.conversationId,
      user_id: event.userId,
    });

    const sessionId = event.conversationId ?? `${event.source}:default`;
    const session = new SessionManager(sessionId, workspace.sessionsDir);
    await session.init();
    const history = await session.load();

    const agentConfig = this.config.agents[event.agentId] ?? this.config.agents.default ?? {};
    const enabledSkills = agentConfig.enabled_skills ?? this.config.skills.enabled;
    const skillRegistry = new SkillRegistry(workspace, this.config.skills.definitions);
    const { skills, diagnostics } = await skillRegistry.loadEnabled(enabledSkills);
    const missingTools = this.findMissingSkillTools(skills, this.buildTools(workspace).map((tool) => tool.name));
    const skillDiagnostics = [...diagnostics, ...missingTools];

    const memory = await this.workspaceManager.readMemory(workspace);
    const systemPrompt = buildSystemPrompt({
      workspace,
      memory,
      skills,
      skillDiagnostics,
      channel: metadataString(event.metadata?.channel) ?? event.source,
      chatId: metadataString(event.metadata?.chat_id),
    });

    const providerName = agentConfig.model_provider ?? this.config.models.defaultProvider;
    const provider = this.providers.get(providerName);
    const model = agentConfig.model;
    const tools = this.buildTools(workspace);

    let userMessage = event.text;
    if (event.source === "heartbeat" || event.source === "cron") {
      userMessage = `[Automated ${event.source} - act on these instructions, do not describe them]\n\n${event.text}`;
    }

    const result = await runAgent({
      userMessage,
      tools,
      history,
      systemPrompt,
      provider,
      model,
      auditLogger: audit,
      callbacks: options.callbacks,
      toolContext: {
        agentId: event.agentId,
        eventId: event.id,
        conversationId: event.conversationId,
        workspace,
        workspaceManager: this.workspaceManager,
      },
    });

    await session.append(result.newMessages);

    return {
      eventId: event.id,
      agentId: event.agentId,
      conversationId: event.conversationId,
      text: result.text,
      toolCalls: result.toolCalls,
      createdAt: new Date().toISOString(),
    };
  }

  async readSession(agentId: string, sessionId: string): Promise<unknown[]> {
    const workspace = await this.workspaceManager.initAgent(agentId);
    const session = new SessionManager(sessionId, workspace.sessionsDir);
    await session.init();
    return await session.loadRaw();
  }

  async listWorkspace(agentId: string, requestedPath = "."): Promise<string[]> {
    const workspace = await this.workspaceManager.initAgent(agentId);
    return await this.workspaceManager.listWorkspaceFiles(workspace, requestedPath);
  }

  async readWorkspaceFile(agentId: string, requestedPath: string): Promise<string> {
    const workspace = await this.workspaceManager.initAgent(agentId);
    const p = await this.workspaceManager.resolvePath(workspace, requestedPath, { mustExist: true });
    const stat = await fs.stat(p);
    if (!stat.isFile()) throw new Error("Path is not a file.");
    return await fs.readFile(p, "utf8");
  }

  makeEvent(input: {
    agentId?: string;
    source: AgentEvent["source"];
    text: string;
    conversationId?: string;
    userId?: string;
    metadata?: Record<string, unknown>;
  }): AgentEvent {
    return {
      id: randomUUID(),
      agentId: input.agentId ?? "default",
      source: input.source,
      conversationId: input.conversationId,
      userId: input.userId,
      text: input.text,
      metadata: input.metadata,
      createdAt: new Date().toISOString(),
    };
  }

  private buildTools(_workspace: { root: string }): Tool[] {
    const tools: Tool[] = [
      new ReadFileTool(),
      new WriteFileTool(),
      new ListFilesTool(),
      new DeleteFileTool(),
      new CreateDirectoryTool(),
      new MoveFileTool(),
    ];

    if (this.cron && this.config.cron.enabled) {
      tools.push(new CronAddTool(this.cron), new CronListTool(this.cron), new CronRemoveTool(this.cron));
    }

    if (this.config.tools.enable_exec) {
      tools.push(new ExecTool());
    }

    return tools;
  }

  private findMissingSkillTools(skills: Array<{ name: string; requiredTools?: string[] }>, toolNames: string[]): string[] {
    const available = new Set(toolNames);
    const diagnostics: string[] = [];
    for (const skill of skills) {
      for (const toolName of skill.requiredTools ?? []) {
        if (!available.has(toolName)) {
          diagnostics.push(`Skill '${skill.name}' requires unavailable tool '${toolName}'.`);
        }
      }
    }
    return diagnostics;
  }
}

export function workspaceCronPath(root: string): string {
  return path.join(root, "cron.json");
}

