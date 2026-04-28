import { spawn } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { Tool } from "./base.js";

const DANGEROUS_PATTERNS: RegExp[] = [
  /rm\s+-rf\s+\//,
  /mkfs/,
  /dd\s+if=/,
  /:\(\)\s*\{.*\}/, // fork bomb
  />\s*\/dev\/sd/,
];

const WORKSPACE = path.join(os.homedir(), ".ai-assistant", "workspace");

export class ExecTool extends Tool {
  name = "exec";
  description =
    "Run a shell command and return the output. Use for listing files, checking system state, running scripts, etc.";
  parameters = {
    type: "object",
    properties: {
      command: {
        type: "string",
        description: "The shell command to execute.",
      },
    },
    required: ["command"],
  };

  private timeoutMs: number;

  constructor(timeoutSeconds = 60) {
    super();
    this.timeoutMs = timeoutSeconds * 1000;
  }

  async execute(args: Record<string, unknown>): Promise<string> {
    const command = String(args.command);

    for (const pattern of DANGEROUS_PATTERNS) {
      if (pattern.test(command)) {
        return `Blocked: command matches dangerous pattern '${pattern}'`;
      }
    }

    return new Promise((resolve) => {
      const proc = spawn(command, {
        shell: true,
        cwd: WORKSPACE,
        stdio: ["ignore", "pipe", "pipe"],
      });

      const chunks: Buffer[] = [];
      proc.stdout.on("data", (d: Buffer) => chunks.push(d));
      proc.stderr.on("data", (d: Buffer) => chunks.push(d));

      const timer = setTimeout(() => {
        proc.kill("SIGKILL");
        resolve(`Error: command timed out after ${this.timeoutMs / 1000}s`);
      }, this.timeoutMs);

      proc.on("error", (e) => {
        clearTimeout(timer);
        resolve(`Error executing command: ${e.message}`);
      });

      proc.on("close", () => {
        clearTimeout(timer);
        const out = Buffer.concat(chunks).toString("utf8").trim();
        resolve(out || "(no output)");
      });
    });
  }
}
