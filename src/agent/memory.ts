import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";

const WORKSPACE = path.join(os.homedir(), ".ai-assistant", "workspace");
const __dirname = path.dirname(fileURLToPath(import.meta.url));
// dist/agent/memory.js → dist/agent → repo root → workspace-templates
const TEMPLATES = path.resolve(__dirname, "..", "..", "workspace-templates");

export class MemoryManager {
  workspace: string = WORKSPACE;

  async init(): Promise<void> {
    await fs.mkdir(this.workspace, { recursive: true });
    await this.seedTemplates();
  }

  private async seedTemplates(): Promise<void> {
    let entries: string[];
    try {
      entries = await fs.readdir(TEMPLATES);
    } catch {
      return;
    }
    const isFresh = !(await this.exists(path.join(this.workspace, "SOUL.md")));
    for (const filename of entries) {
      if (filename === "BOOTSTRAP.md" && !isFresh) continue;
      const dest = path.join(this.workspace, filename);
      if (!(await this.exists(dest))) {
        await fs.copyFile(path.join(TEMPLATES, filename), dest);
      }
    }
  }

  private async exists(p: string): Promise<boolean> {
    try {
      await fs.access(p);
      return true;
    } catch {
      return false;
    }
  }

  async readAll(): Promise<Record<string, string>> {
    const files = ["AGENTS.md", "BOOTSTRAP.md", "MEMORY.md", "SOUL.md", "USER.md"];
    const result: Record<string, string> = {};
    for (const filename of files) {
      const p = path.join(this.workspace, filename);
      try {
        const content = (await fs.readFile(p, "utf8")).trim();
        if (content) {
          const key = path.parse(filename).name.toLowerCase();
          result[key] = content;
        }
      } catch {
        // missing file — skip
      }
    }
    return result;
  }
}
