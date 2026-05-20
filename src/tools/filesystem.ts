import { promises as fs } from "node:fs";
import path from "node:path";
import { Tool, type ToolExecutionContext, type ToolExecutionResult } from "./base.js";

async function fileResult<T>(
  action: () => Promise<ToolExecutionResult>,
): Promise<ToolExecutionResult> {
  try {
    return await action();
  } catch (e) {
    return {
      content: `Error: ${(e as Error).message}`,
      error: (e as Error).message,
    };
  }
}

export class ReadFileTool extends Tool {
  name = "read_file";
  description = "Read the contents of a file inside the current agent workspace.";
  parameters = {
    type: "object",
    properties: {
      path: {
        type: "string",
        description: "Path to read, relative to the agent workspace. Absolute paths must stay inside the workspace.",
      },
    },
    required: ["path"],
  };

  async execute(args: Record<string, unknown>, context: ToolExecutionContext): Promise<ToolExecutionResult> {
    return fileResult(async () => {
      const p = await context.workspaceManager.resolvePath(context.workspace, String(args.path), { mustExist: true });
      const stat = await fs.stat(p);
      if (!stat.isFile()) throw new Error("Path is not a file.");
      return { content: await fs.readFile(p, "utf8") };
    });
  }
}

export class WriteFileTool extends Tool {
  name = "write_file";
  description = "Write content to a file inside the current agent workspace, creating directories as needed.";
  parameters = {
    type: "object",
    properties: {
      path: {
        type: "string",
        description: "Path to write, relative to the agent workspace. Absolute paths must stay inside the workspace.",
      },
      content: {
        type: "string",
        description: "The content to write to the file.",
      },
    },
    required: ["path", "content"],
  };

  async execute(args: Record<string, unknown>, context: ToolExecutionContext): Promise<ToolExecutionResult> {
    return fileResult(async () => {
      const p = await context.workspaceManager.resolvePath(context.workspace, String(args.path));
      const content = String(args.content);
      await fs.mkdir(path.dirname(p), { recursive: true });
      await fs.writeFile(p, content, "utf8");
      return {
        content: `Wrote ${Buffer.byteLength(content, "utf8")} bytes to ${path.relative(context.workspace.root, p)}`,
        changedWorkspace: true,
      };
    });
  }
}

export class ListFilesTool extends Tool {
  name = "list_files";
  description = "List files and directories inside the current agent workspace.";
  parameters = {
    type: "object",
    properties: {
      path: {
        type: "string",
        description: "Directory path to list, relative to the agent workspace. Defaults to the workspace root.",
      },
    },
    required: [],
  };

  async execute(args: Record<string, unknown>, context: ToolExecutionContext): Promise<ToolExecutionResult> {
    return fileResult(async () => {
      const requestedPath = typeof args.path === "string" && args.path.trim() ? args.path : ".";
      const p = await context.workspaceManager.resolvePath(context.workspace, requestedPath, { mustExist: true });
      const stat = await fs.stat(p);
      if (!stat.isDirectory()) throw new Error("Path is not a directory.");

      const entries = await fs.readdir(p, { withFileTypes: true });
      const lines = entries
        .map((entry) => `${entry.isDirectory() ? "dir " : "file"} ${entry.name}`)
        .sort();
      return { content: lines.length ? lines.join("\n") : "(empty)" };
    });
  }
}

export class DeleteFileTool extends Tool {
  name = "delete_file";
  description = "Delete a file inside the current agent workspace.";
  parameters = {
    type: "object",
    properties: {
      path: {
        type: "string",
        description: "File path to delete, relative to the agent workspace.",
      },
    },
    required: ["path"],
  };

  async execute(args: Record<string, unknown>, context: ToolExecutionContext): Promise<ToolExecutionResult> {
    return fileResult(async () => {
      const p = await context.workspaceManager.resolvePath(context.workspace, String(args.path), { mustExist: true });
      const stat = await fs.stat(p);
      if (!stat.isFile()) throw new Error("delete_file can only delete files.");
      await fs.unlink(p);
      return {
        content: `Deleted ${path.relative(context.workspace.root, p)}`,
        changedWorkspace: true,
      };
    });
  }
}

export class CreateDirectoryTool extends Tool {
  name = "create_directory";
  description = "Create a directory inside the current agent workspace.";
  parameters = {
    type: "object",
    properties: {
      path: {
        type: "string",
        description: "Directory path to create, relative to the agent workspace.",
      },
    },
    required: ["path"],
  };

  async execute(args: Record<string, unknown>, context: ToolExecutionContext): Promise<ToolExecutionResult> {
    return fileResult(async () => {
      const p = await context.workspaceManager.resolvePath(context.workspace, String(args.path));
      await fs.mkdir(p, { recursive: true });
      return {
        content: `Created directory ${path.relative(context.workspace.root, p)}`,
        changedWorkspace: true,
      };
    });
  }
}

export class MoveFileTool extends Tool {
  name = "move_file";
  description = "Move or rename a file inside the current agent workspace.";
  parameters = {
    type: "object",
    properties: {
      source: {
        type: "string",
        description: "Source file path, relative to the agent workspace.",
      },
      destination: {
        type: "string",
        description: "Destination file path, relative to the agent workspace.",
      },
    },
    required: ["source", "destination"],
  };

  async execute(args: Record<string, unknown>, context: ToolExecutionContext): Promise<ToolExecutionResult> {
    return fileResult(async () => {
      const source = await context.workspaceManager.resolvePath(context.workspace, String(args.source), {
        mustExist: true,
      });
      const destination = await context.workspaceManager.resolvePath(context.workspace, String(args.destination));
      const stat = await fs.stat(source);
      if (!stat.isFile()) throw new Error("move_file can only move files.");

      await fs.mkdir(path.dirname(destination), { recursive: true });
      await fs.rename(source, destination);
      return {
        content: `Moved ${path.relative(context.workspace.root, source)} to ${path.relative(
          context.workspace.root,
          destination,
        )}`,
        changedWorkspace: true,
      };
    });
  }
}

