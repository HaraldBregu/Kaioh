import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import { randomUUID } from "node:crypto";
import cronParser from "cron-parser";
import type { InboundMessage, AsyncQueue } from "../types.js";

const CRON_PATH = path.join(os.homedir(), ".ai-assistant", "cron.json");

export interface CronJob {
  id: string;
  schedule: string;
  message: string;
  channel: string;
  chat_id: string;
  enabled: boolean;
  next_run: string | null;
}

const UNIT_MAP: Record<string, number> = { s: 1, m: 60, h: 3600 };

function nextRun(schedule: string, now: Date): Date {
  // "in:5m", "in:30s", "in:2h" — one-shot relative
  if (schedule.startsWith("in:")) {
    const spec = schedule.slice(3);
    const unit = spec.slice(-1);
    const n = parseInt(spec.slice(0, -1), 10);
    return new Date(now.getTime() + n * UNIT_MAP[unit] * 1000);
  }

  // "interval:N" — recurring every N seconds
  if (schedule.startsWith("interval:")) {
    const secs = parseInt(schedule.split(":")[1], 10);
    return new Date(now.getTime() + secs * 1000);
  }

  // cron expression
  const it = cronParser.parseExpression(schedule, { currentDate: now, utc: true });
  return it.next().toDate();
}

export class CronService {
  private queue: AsyncQueue<InboundMessage>;
  private filePath: string;
  private jobs: CronJob[] = [];
  private stopped = false;

  constructor(queue: AsyncQueue<InboundMessage>, filePath: string = CRON_PATH) {
    this.queue = queue;
    this.filePath = filePath;
  }

  async load(): Promise<void> {
    try {
      const raw = await fs.readFile(this.filePath, "utf8");
      const data = JSON.parse(raw) as CronJob[];
      const now = new Date();
      for (const item of data) {
        const job: CronJob = {
          id: item.id,
          schedule: item.schedule,
          message: item.message,
          channel: item.channel,
          chat_id: item.chat_id,
          enabled: item.enabled ?? true,
          next_run: item.next_run ?? null,
        };
        if (job.enabled) {
          job.next_run = nextRun(job.schedule, now).toISOString();
        }
        this.jobs.push(job);
      }
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
    }
  }

  private async save(): Promise<void> {
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    await fs.writeFile(this.filePath, JSON.stringify(this.jobs, null, 2));
  }

  async add(schedule: string, message: string, channel: string, chat_id: string): Promise<CronJob> {
    const job: CronJob = {
      id: randomUUID(),
      schedule,
      message,
      channel,
      chat_id,
      enabled: true,
      next_run: nextRun(schedule, new Date()).toISOString(),
    };
    this.jobs.push(job);
    await this.save();
    return job;
  }

  async remove(jobId: string): Promise<boolean> {
    const before = this.jobs.length;
    this.jobs = this.jobs.filter((j) => j.id !== jobId);
    if (this.jobs.length < before) {
      await this.save();
      return true;
    }
    return false;
  }

  listJobs(): CronJob[] {
    return [...this.jobs];
  }

  stop(): void {
    this.stopped = true;
  }

  async run(): Promise<void> {
    while (!this.stopped) {
      const now = new Date();
      let dirty = false;
      for (const job of this.jobs) {
        if (!job.enabled || !job.next_run) continue;
        if (new Date(job.next_run) <= now) {
          await this.queue.put({
            channel: job.channel,
            chat_id: job.chat_id,
            sender_id: "cron",
            text: job.message,
          });
          if (job.schedule.startsWith("in:")) {
            job.enabled = false; // one-shot — done
          } else {
            job.next_run = nextRun(job.schedule, now).toISOString();
          }
          dirty = true;
        }
      }
      if (dirty) await this.save();
      await new Promise((r) => setTimeout(r, 10_000));
    }
  }
}
