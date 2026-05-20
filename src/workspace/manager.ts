import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEMPLATES = path.resolve(__dirname, "..", "..", "workspace-templates");

export const DEFAULT_WORKSPACE_ROOT = path.join(os.homedir(), ".ai-assistant", "workspace");

export interface AgentWorkspace {
  agentId: string;
  root: string;
  filesDir: string;
  memoryDir: string;
  skillsDir: string;
  sessionsDir: string;
  schedulesDir: string;
  logsDir: string;
}

export interface ResolvePathOptions {
  mustExist?: boolean;
}

function sanitizeSegment(value: string): string {
  const clean = value.trim().replace(/[^a-zA-Z0-9_.:-]/g, "_");
  return clean || "default";
}

async function exists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

function isInside(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

export class WorkspaceManager {
  readonly root: string;

  constructor(root: string = DEFAULT_WORKSPACE_ROOT) {
    this.root = path.resolve(root);
  }

  agentPath(agentId: string): string {
    return path.join(this.root, "agents", sanitizeSegment(agentId));
  }

  async initAgent(agentId: string): Promise<AgentWorkspace> {
    const safeAgentId = sanitizeSegment(agentId);
    const root = this.agentPath(safeAgentId);
    const workspace: AgentWorkspace = {
      agentId: safeAgentId,
      root,
      filesDir: path.join(root, "files"),
      memoryDir: path.join(root, "memory"),
      skillsDir: path.join(root, "skills"),
      sessionsDir: path.join(root, "sessions"),
      schedulesDir: path.join(root, "schedules"),
      logsDir: path.join(root, "logs"),
    };

    await fs.mkdir(workspace.filesDir, { recursive: true });
    await fs.mkdir(workspace.memoryDir, { recursive: true });
    await fs.mkdir(workspace.skillsDir, { recursive: true });
    await fs.mkdir(workspace.sessionsDir, { recursive: true });
    await fs.mkdir(workspace.schedulesDir, { recursive: true });
    await fs.mkdir(workspace.logsDir, { recursive: true });
    await this.seedTemplates(workspace);

    return workspace;
  }

  async resolvePath(
    workspace: AgentWorkspace,
    requestedPath: string,
    options: ResolvePathOptions = {},
  ): Promise<string> {
    const raw = String(requestedPath || ".").trim();
    const candidate = path.resolve(path.isAbsolute(raw) ? raw : path.join(workspace.root, raw));
    const realRoot = await fs.realpath(workspace.root);

    if (!isInside(realRoot, candidate) && !isInside(workspace.root, candidate)) {
      throw new Error(`Path escapes agent workspace: ${requestedPath}`);
    }

    if (options.mustExist) {
      const realCandidate = await fs.realpath(candidate);
      if (!isInside(realRoot, realCandidate)) {
        throw new Error(`Path resolves outside agent workspace: ${requestedPath}`);
      }
      return realCandidate;
    }

    const parent = await this.findExistingParent(candidate);
    const realParent = await fs.realpath(parent);
    if (!isInside(realRoot, realParent)) {
      throw new Error(`Path parent resolves outside agent workspace: ${requestedPath}`);
    }

    return candidate;
  }

  async readMemory(workspace: AgentWorkspace): Promise<Record<string, string>> {
    const files = ["AGENTS.md", "BOOTSTRAP.md", "MEMORY.md", "SOUL.md", "USER.md", "HEARTBEAT.md"];
    const result: Record<string, string> = {};
    for (const filename of files) {
      const p = path.join(workspace.memoryDir, filename);
      try {
        const content = (await fs.readFile(p, "utf8")).trim();
        if (content) {
          const key = path.parse(filename).name.toLowerCase();
          result[key] = content;
        }
      } catch {
        // missing memory files are allowed
      }
    }
    return result;
  }

  async listWorkspaceFiles(workspace: AgentWorkspace, requestedPath = "."): Promise<string[]> {
    const p = await this.resolvePath(workspace, requestedPath, { mustExist: true });
    const entries = await fs.readdir(p, { withFileTypes: true });
    return entries.map((entry) => `${entry.name}${entry.isDirectory() ? "/" : ""}`).sort();
  }

  private async seedTemplates(workspace: AgentWorkspace): Promise<void> {
    let entries: string[];
    try {
      entries = await fs.readdir(TEMPLATES);
    } catch {
      return;
    }

    const isFresh = !(await exists(path.join(workspace.memoryDir, "SOUL.md")));
    for (const filename of entries) {
      if (filename === "BOOTSTRAP.md" && !isFresh) continue;
      const dest = path.join(workspace.memoryDir, filename);
      if (!(await exists(dest))) {
        await fs.copyFile(path.join(TEMPLATES, filename), dest);
      }
    }
  }

  private async findExistingParent(candidate: string): Promise<string> {
    let current = path.dirname(candidate);
    while (!(await exists(current))) {
      const parent = path.dirname(current);
      if (parent === current) break;
      current = parent;
    }
    return current;
  }
}

