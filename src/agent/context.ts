import type { AgentSkill } from "../skills/registry.js";
import type { AgentWorkspace } from "../workspace/manager.js";

export interface SystemPromptInput {
  workspace: AgentWorkspace;
  memory: Record<string, string>;
  skills: AgentSkill[];
  skillDiagnostics?: string[];
  channel?: string;
  chatId?: string;
}

export function buildSystemPrompt(input: SystemPromptInput): string {
  const now = new Date().toISOString().replace("T", " ").slice(0, 16) + " UTC";
  const parts = [
    "You are a personal AI assistant running inside an isolated agent workspace.",
    `Current date/time: ${now}`,
    `Agent ID: ${input.workspace.agentId}`,
    `Workspace root: ${input.workspace.root}`,
    `Files directory: ${input.workspace.filesDir}`,
    `Memory directory: ${input.workspace.memoryDir}`,
    "Always use workspace-relative paths when calling filesystem tools unless an absolute path is already inside the workspace.",
    "Never attempt to access files outside the current agent workspace.",
  ];

  if (input.channel) parts.push(`Channel: ${input.channel}`);
  if (input.chatId) parts.push(`Chat ID: ${input.chatId}`);

  const sections = [parts.join("\n")];
  for (const [tag, content] of Object.entries(input.memory)) {
    sections.push(`<${tag}>\n${content}\n</${tag}>`);
  }

  if (input.skills.length > 0) {
    sections.push(
      `<skills>\n${input.skills
        .map(
          (skill) =>
            `## ${skill.name} v${skill.version}\n${skill.description}\n\nActivation rules:\n${skill.activationRules
              .map((rule) => `- ${rule}`)
              .join("\n")}\n\n${skill.instructions}`,
        )
        .join("\n\n")}\n</skills>`,
    );
  }

  if (input.skillDiagnostics?.length) {
    sections.push(`<skill_diagnostics>\n${input.skillDiagnostics.join("\n")}\n</skill_diagnostics>`);
  }

  return sections.join("\n\n");
}

