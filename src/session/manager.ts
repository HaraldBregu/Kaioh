import { promises as fs } from "node:fs";
import path from "node:path";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";

function safeFileName(value: string): string {
  const safe = value.trim().replace(/[^a-zA-Z0-9_.:-]/g, "_");
  return safe || "default";
}

export class SessionManager {
  readonly sessionKey: string;
  readonly filePath: string;

  constructor(sessionKey: string, sessionsDir: string) {
    this.sessionKey = safeFileName(sessionKey);
    this.filePath = path.join(sessionsDir, `${this.sessionKey}.jsonl`);
  }

  async init(): Promise<void> {
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    try {
      await fs.access(this.filePath);
    } catch {
      const meta = JSON.stringify({
        session_key: this.sessionKey,
        created_at: new Date().toISOString(),
      });
      await fs.writeFile(this.filePath, meta + "\n", "utf8");
    }
  }

  async load(n = 50): Promise<ChatCompletionMessageParam[]> {
    let raw: string;
    try {
      raw = await fs.readFile(this.filePath, "utf8");
    } catch {
      return [];
    }
    const lines = raw.split("\n").filter(Boolean);
    const messages: ChatCompletionMessageParam[] = [];
    for (const line of lines.slice(1)) {
      try {
        const entry = JSON.parse(line);
        delete entry.timestamp;
        messages.push(entry);
      } catch {
        // skip invalid session lines
      }
    }
    return messages.slice(-n);
  }

  async loadRaw(): Promise<unknown[]> {
    let raw: string;
    try {
      raw = await fs.readFile(this.filePath, "utf8");
    } catch {
      return [];
    }
    return raw
      .split("\n")
      .filter(Boolean)
      .map((line) => {
        try {
          return JSON.parse(line) as unknown;
        } catch {
          return null;
        }
      })
      .filter((entry): entry is unknown => entry !== null);
  }

  async append(messages: ChatCompletionMessageParam[]): Promise<void> {
    if (messages.length === 0) return;
    const lines = messages
      .map((m) => JSON.stringify({ ...m, timestamp: new Date().toISOString() }))
      .join("\n");
    await fs.appendFile(this.filePath, lines + "\n", "utf8");
  }
}

