import { Tool, type ToolExecutionContext, type ToolExecutionResult } from "./base.js";
import { CronService } from "../cron/service.js";

export class CronAddTool extends Tool {
  name = "cron_add";
  description =
    "Schedule a future message for this agent. Use 'in:Nm' for one-shot, " +
    "'interval:N' for recurring every N seconds, or a cron expression like '0 9 * * *'.";
  parameters = {
    type: "object",
    properties: {
      schedule: {
        type: "string",
        description: "When to fire. Examples: 'in:5m', 'in:1h', 'interval:3600', '0 9 * * *'",
      },
      message: { type: "string", description: "The message to inject when the job fires." },
      conversation_id: {
        type: "string",
        description: "Optional conversation ID. Defaults to the current conversation.",
      },
    },
    required: ["schedule", "message"],
  };

  constructor(private cron: CronService) {
    super();
  }

  async execute(args: Record<string, unknown>, context: ToolExecutionContext): Promise<ToolExecutionResult> {
    try {
      const job = await this.cron.add({
        agentId: context.agentId,
        conversationId:
          typeof args.conversation_id === "string" && args.conversation_id ? args.conversation_id : context.conversationId,
        schedule: String(args.schedule),
        message: String(args.message),
      });
      return {
        content: `Scheduled job ${job.id}: '${job.message}' (next run: ${job.next_run})`,
        changedWorkspace: true,
      };
    } catch (e) {
      return {
        content: `Error scheduling job: ${(e as Error).message}`,
        error: (e as Error).message,
      };
    }
  }
}

export class CronListTool extends Tool {
  name = "cron_list";
  description = "List scheduled jobs for this agent.";
  parameters = { type: "object", properties: {}, required: [] };

  constructor(private cron: CronService) {
    super();
  }

  async execute(_args: Record<string, unknown>, context: ToolExecutionContext): Promise<ToolExecutionResult> {
    const jobs = this.cron.listJobs(context.agentId);
    if (jobs.length === 0) return { content: "No jobs scheduled." };
    return {
      content: jobs
        .map((j) => {
          const status = j.enabled ? "enabled" : "disabled";
          return `[${j.id.slice(0, 8)}] '${j.schedule}' -> '${j.message}' (${status}, next: ${j.next_run})`;
        })
        .join("\n"),
    };
  }
}

export class CronRemoveTool extends Tool {
  name = "cron_remove";
  description = "Remove a scheduled job by ID.";
  parameters = {
    type: "object",
    properties: {
      job_id: { type: "string", description: "The job ID to remove, or its first characters." },
    },
    required: ["job_id"],
  };

  constructor(private cron: CronService) {
    super();
  }

  async execute(args: Record<string, unknown>, context: ToolExecutionContext): Promise<ToolExecutionResult> {
    let jobId = String(args.job_id);
    if (jobId.length < 36) {
      const match = this.cron.listJobs(context.agentId).find((j) => j.id.startsWith(jobId));
      if (match) jobId = match.id;
    }
    const removed = await this.cron.remove(jobId, context.agentId);
    return {
      content: removed ? `Removed job ${jobId}.` : `No job found with ID ${jobId}.`,
      changedWorkspace: removed,
    };
  }
}

