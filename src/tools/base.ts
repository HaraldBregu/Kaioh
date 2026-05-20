import type { AgentWorkspace, WorkspaceManager } from "../workspace/manager.js";

export interface ToolSchema {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

export interface ToolExecutionContext {
  agentId: string;
  eventId?: string;
  conversationId?: string;
  workspace: AgentWorkspace;
  workspaceManager: WorkspaceManager;
}

export interface ToolExecutionResult {
  content: string;
  changedWorkspace?: boolean;
  error?: string;
  metadata?: Record<string, unknown>;
}

export abstract class Tool {
  abstract name: string;
  abstract description: string;
  abstract parameters: Record<string, unknown>;

  abstract execute(args: Record<string, unknown>, context: ToolExecutionContext): Promise<ToolExecutionResult>;

  schema(): ToolSchema {
    return {
      type: "function",
      function: {
        name: this.name,
        description: this.description,
        parameters: this.parameters,
      },
    };
  }
}

export class ToolRegistry {
  private tools = new Map<string, Tool>();

  constructor(tools: Tool[] = []) {
    for (const tool of tools) this.register(tool);
  }

  register(tool: Tool): void {
    this.tools.set(tool.name, tool);
  }

  get(name: string): Tool | undefined {
    return this.tools.get(name);
  }

  list(): Tool[] {
    return [...this.tools.values()];
  }
}

