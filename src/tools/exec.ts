import { spawn } from "node:child_process";
import { Tool, type ToolExecutionContext, type ToolExecutionResult } from "./base.js";

const DANGEROUS_PATTERNS: RegExp[] = [
  /rm\s+-rf\s+\//,
  /mkfs/,
  /dd\s+if=/,
  /:\(\)\s*\{.*\}/, // fork bomb
  />\s*\/dev\/sd/,
];

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

  async execute(args: Record<string, unknown>, context: ToolExecutionContext): Promise<ToolExecutionResult> {
    const command = String(args.command);

    for (const pattern of DANGEROUS_PATTERNS) {
      if (pattern.test(command)) {
        return {
          content: `Blocked: command matches dangerous pattern '${pattern}'`,
          error: "dangerous_command",
        };
      }
    }

    return new Promise((resolve) => {
      const proc = spawn(command, {
        shell: true,
        cwd: context.workspace.root,
        stdio: ["ignore", "pipe", "pipe"],
      });

      const chunks: Buffer[] = [];
      proc.stdout.on("data", (d: Buffer) => chunks.push(d));
      proc.stderr.on("data", (d: Buffer) => chunks.push(d));

      const timer = setTimeout(() => {
        proc.kill("SIGKILL");
        resolve({
          content: `Error: command timed out after ${this.timeoutMs / 1000}s`,
          error: "timeout",
        });
      }, this.timeoutMs);

      proc.on("error", (e) => {
        clearTimeout(timer);
        resolve({
          content: `Error executing command: ${e.message}`,
          error: e.message,
        });
      });

      proc.on("close", (code) => {
        clearTimeout(timer);
        const out = Buffer.concat(chunks).toString("utf8").trim();
        resolve({
          content: out || "(no output)",
          error: code && code !== 0 ? `exit_${code}` : undefined,
        });
      });
    });
  }
}
