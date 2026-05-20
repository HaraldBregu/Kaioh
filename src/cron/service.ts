import { promises as fs } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import cronParser from "cron-parser";
import type { AgentEvent, AsyncQueue } from "../types.js";

export interface CronJob {
  id: string;
  agentId: string;
  conversationId?: string;
  userId?: string;
  schedule: string;
  message: string;
  enabled: boolean;
  next_run: string | null;
  metadata?: Record<string, unknown>;
}

export interface CronAddInput {
  agentId: string;
  conversationId?: string;
  userId?: string;
  schedule: string;
  message: string;
  metadata?: Record<string, unknown>;
}

const UNIT_MAP: Record<string, number> = { s: 1, m: 60, h: 3600 };

function nextRun(schedule: string, now: Date): Date {
  if (schedule.startsWith("in:")) {
    const spec = schedule.slice(3);
    const unit = spec.slice(-1);
    const n = parseInt(spec.slice(0, -1), 10);
    if (!Number.isFinite(n) || !UNIT_MAP[unit]) throw new Error(`Invalid relative schedule '${schedule}'.`);
    return new Date(now.getTime() + n * UNIT_MAP[unit] * 1000);
  }

  if (schedule.startsWith("interval:")) {
    const secs = parseInt(schedule.split(":")[1], 10);
    if (!Number.isFinite(secs) || secs <= 0) throw new Error(`Invalid interval schedule '${schedule}'.`);
    return new Date(now.getTime() + secs * 1000);
  }

  const it = cronParser.parseExpression(schedule, { currentDate: now, utc: true });
  return it.next().toDate();
}

export class CronService {
  private jobs: CronJob[] = [];
  private stopped = false;

  constructor(
    private queue: AsyncQueue<AgentEvent>,
    private filePath: string,
    private pollIntervalMs = 10_000,
  ) {}

  async load(): Promise<void> {
    try {
      const raw = await fs.readFile(this.filePath, "utf8");
      const data = JSON.parse(raw) as CronJob[];
      const now = new Date();
      this.jobs = data.map((item) => {
        const job: CronJob = {
          id: item.id,
          agentId: item.agentId ?? "default",
          conversationId: item.conversationId,
          userId: item.userId,
          schedule: item.schedule,
          message: item.message,
          enabled: item.enabled ?? true,
          next_run: item.next_run ?? null,
          metadata: item.metadata,
        };
        if (job.enabled) {
          job.next_run = nextRun(job.schedule, now).toISOString();
        }
        return job;
      });
      await this.save();
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
    }
  }

  async add(input: CronAddInput): Promise<CronJob> {
    const job: CronJob = {
      id: randomUUID(),
      agentId: input.agentId,
      conversationId: input.conversationId,
      userId: input.userId,
      schedule: input.schedule,
      message: input.message,
      enabled: true,
      next_run: nextRun(input.schedule, new Date()).toISOString(),
      metadata: input.metadata,
    };
    this.jobs.push(job);
    await this.save();
    return job;
  }

  async remove(jobId: string, agentId?: string): Promise<boolean> {
    const before = this.jobs.length;
    this.jobs = this.jobs.filter((job) => {
      if (agentId && job.agentId !== agentId) return true;
      return job.id !== jobId;
    });
    if (this.jobs.length < before) {
      await this.save();
      return true;
    }
    return false;
  }

  async setEnabled(jobId: string, enabled: boolean, agentId?: string): Promise<boolean> {
    const job = this.jobs.find((candidate) => candidate.id === jobId && (!agentId || candidate.agentId === agentId));
    if (!job) return false;
    job.enabled = enabled;
    job.next_run = enabled ? nextRun(job.schedule, new Date()).toISOString() : null;
    await this.save();
    return true;
  }

  listJobs(agentId?: string): CronJob[] {
    return this.jobs.filter((job) => !agentId || job.agentId === agentId).map((job) => ({ ...job }));
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
          this.queue.put({
            id: randomUUID(),
            agentId: job.agentId,
            source: "cron",
            conversationId: job.conversationId,
            userId: job.userId,
            text: job.message,
            metadata: job.metadata,
            createdAt: new Date().toISOString(),
          });
          if (job.schedule.startsWith("in:")) {
            job.enabled = false;
            job.next_run = null;
          } else {
            job.next_run = nextRun(job.schedule, now).toISOString();
          }
          dirty = true;
        }
      }
      if (dirty) await this.save();
      await new Promise((resolve) => setTimeout(resolve, this.pollIntervalMs));
    }
  }

  private async save(): Promise<void> {
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    await fs.writeFile(this.filePath, JSON.stringify(this.jobs, null, 2), "utf8");
  }
}

