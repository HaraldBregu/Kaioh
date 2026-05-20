import { promises as fs } from "node:fs";
import path from "node:path";
import type { ToolCallRecord } from "../types.js";
import type { AgentWorkspace } from "../workspace/manager.js";

export class AuditLogger {
  private filePath: string;

  constructor(workspace: AgentWorkspace) {
    this.filePath = path.join(workspace.logsDir, "audit.jsonl");
  }

  async toolCall(record: ToolCallRecord): Promise<void> {
    await this.append({
      type: "tool_call",
      ...record,
    });
  }

  async event(data: Record<string, unknown>): Promise<void> {
    await this.append({
      type: "event",
      timestamp: new Date().toISOString(),
      ...data,
    });
  }

  private async append(entry: Record<string, unknown>): Promise<void> {
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    await fs.appendFile(this.filePath, JSON.stringify(entry) + "\n", "utf8");
  }
}

