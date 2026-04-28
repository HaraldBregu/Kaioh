import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";

const SESSIONS_DIR = path.join(os.homedir(), ".ai-assistant", "sessions");

export class SessionManager {
  sessionKey: string;
  filePath: string;

  constructor(sessionKey: string) {
    this.sessionKey = sessionKey;
    this.filePath = path.join(SESSIONS_DIR, `${sessionKey}.jsonl`);
  }

  async init(): Promise<void> {
    await fs.mkdir(SESSIONS_DIR, { recursive: true });
    try {
      await fs.access(this.filePath);
    } catch {
      const meta = JSON.stringify({
        session_key: this.sessionKey,
        created_at: new Date().toISOString(),
      });
      await fs.writeFile(this.filePath, meta + "\n");
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
        // skip
      }
    }
    return messages.slice(-n);
  }

  async append(messages: ChatCompletionMessageParam[]): Promise<void> {
    const lines = messages
      .map((m) => JSON.stringify({ ...m, timestamp: new Date().toISOString() }))
      .join("\n");
    await fs.appendFile(this.filePath, lines + "\n");
  }
}
