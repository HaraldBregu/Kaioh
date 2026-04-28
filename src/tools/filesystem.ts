import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import { Tool } from "./base.js";

function expandUser(p: string): string {
  if (p.startsWith("~")) return path.join(os.homedir(), p.slice(1));
  return p;
}

export class ReadFileTool extends Tool {
  name = "read_file";
  description = "Read the contents of a file at the given path.";
  parameters = {
    type: "object",
    properties: {
      path: {
        type: "string",
        description: "Absolute or relative path to the file to read.",
      },
    },
    required: ["path"],
  };

  async execute(args: Record<string, unknown>): Promise<string> {
    const p = expandUser(String(args.path));
    try {
      return await fs.readFile(p, "utf8");
    } catch (e) {
      return `Error reading file: ${(e as Error).message}`;
    }
  }
}

export class WriteFileTool extends Tool {
  name = "write_file";
  description = "Write content to a file at the given path, creating directories as needed.";
  parameters = {
    type: "object",
    properties: {
      path: {
        type: "string",
        description: "Absolute or relative path to the file to write.",
      },
      content: {
        type: "string",
        description: "The content to write to the file.",
      },
    },
    required: ["path", "content"],
  };

  async execute(args: Record<string, unknown>): Promise<string> {
    const p = expandUser(String(args.path));
    const content = String(args.content);
    try {
      const dir = path.dirname(p) || ".";
      await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(p, content, "utf8");
      return `Wrote ${Buffer.byteLength(content, "utf8")} bytes to ${p}`;
    } catch (e) {
      return `Error writing file: ${(e as Error).message}`;
    }
  }
}
