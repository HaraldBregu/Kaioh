import { Tool } from "./base.js";
import { CronService } from "../cron/service.js";

export class CronAddTool extends Tool {
  name = "cron_add";
  description =
    "Schedule a future message to be injected into this conversation. " +
    "Use 'in:Nm' for one-shot (e.g. 'in:5m'), 'interval:N' for recurring every N seconds, " +
    "or a cron expression like '0 9 * * *'.";
  parameters = {
    type: "object",
    properties: {
      schedule: {
        type: "string",
        description: "When to fire. Examples: 'in:5m', 'in:1h', 'interval:3600', '0 9 * * *'",
      },
      message: { type: "string", description: "The message to inject when the job fires." },
      channel: { type: "string", description: "Channel to send to (e.g. 'telegram')." },
      chat_id: { type: "string", description: "Chat ID to send to." },
    },
    required: ["schedule", "message", "channel", "chat_id"],
  };

  constructor(private cron: CronService) {
    super();
  }

  async execute(args: Record<string, unknown>): Promise<string> {
    const job = await this.cron.add(
      String(args.schedule),
      String(args.message),
      String(args.channel),
      String(args.chat_id),
    );
    return `Scheduled job ${job.id}: '${job.message}' (next run: ${job.next_run})`;
  }
}

export class CronListTool extends Tool {
  name = "cron_list";
  description = "List all scheduled cron jobs.";
  parameters = { type: "object", properties: {}, required: [] };

  constructor(private cron: CronService) {
    super();
  }

  async execute(_args: Record<string, unknown>): Promise<string> {
    const jobs = this.cron.listJobs();
    if (jobs.length === 0) return "No jobs scheduled.";
    return jobs
      .map((j) => {
        const status = j.enabled ? "enabled" : "disabled";
        return `[${j.id.slice(0, 8)}] '${j.schedule}' → '${j.message}' (${status}, next: ${j.next_run})`;
      })
      .join("\n");
  }
}

export class CronRemoveTool extends Tool {
  name = "cron_remove";
  description = "Remove a scheduled cron job by ID.";
  parameters = {
    type: "object",
    properties: {
      job_id: { type: "string", description: "The job ID to remove (or first 8 chars)." },
    },
    required: ["job_id"],
  };

  constructor(private cron: CronService) {
    super();
  }

  async execute(args: Record<string, unknown>): Promise<string> {
    let jobId = String(args.job_id);
    if (jobId.length < 36) {
      const match = this.cron.listJobs().find((j) => j.id.startsWith(jobId));
      if (match) jobId = match.id;
    }
    const removed = await this.cron.remove(jobId);
    return removed ? `Removed job ${jobId}.` : `No job found with ID ${jobId}.`;
  }
}
