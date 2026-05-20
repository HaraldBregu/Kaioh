import { promises as fs } from "node:fs";
import path from "node:path";
import type { AgentWorkspace } from "../workspace/manager.js";

export interface AgentSkill {
  name: string;
  description: string;
  version: string;
  activationRules: string[];
  instructions: string;
  requiredTools?: string[];
  configSchema?: Record<string, unknown>;
}

export interface SkillDefinition {
  name: string;
  description?: string;
  version?: string;
  activationRules?: string[];
  instructions: string;
  requiredTools?: string[];
  configSchema?: Record<string, unknown>;
}

function fromDefinition(def: SkillDefinition): AgentSkill {
  return {
    name: def.name,
    description: def.description ?? "",
    version: def.version ?? "1.0.0",
    activationRules: def.activationRules ?? [],
    instructions: def.instructions,
    requiredTools: def.requiredTools ?? [],
    configSchema: def.configSchema,
  };
}

export class SkillRegistry {
  constructor(
    private workspace: AgentWorkspace,
    private definitions: SkillDefinition[] = [],
  ) {}

  async loadEnabled(enabled: string[]): Promise<{ skills: AgentSkill[]; diagnostics: string[] }> {
    const diagnostics: string[] = [];
    const skills = new Map<string, AgentSkill>();

    for (const def of this.definitions) {
      skills.set(def.name, fromDefinition(def));
    }

    for (const skill of await this.loadWorkspaceSkills()) {
      skills.set(skill.name, skill);
    }

    const selected: AgentSkill[] = [];
    for (const name of enabled) {
      const skill = skills.get(name);
      if (!skill) {
        diagnostics.push(`Skill '${name}' is configured but was not found.`);
        continue;
      }
      selected.push(skill);
    }

    return { skills: selected, diagnostics };
  }

  private async loadWorkspaceSkills(): Promise<AgentSkill[]> {
    let entries: string[];
    try {
      entries = await fs.readdir(this.workspace.skillsDir);
    } catch {
      return [];
    }

    const skills: AgentSkill[] = [];
    for (const entry of entries) {
      const p = path.join(this.workspace.skillsDir, entry);
      const stat = await fs.stat(p);
      if (!stat.isFile()) continue;

      if (entry.endsWith(".json")) {
        const parsed = JSON.parse(await fs.readFile(p, "utf8")) as SkillDefinition;
        skills.push(fromDefinition(parsed));
        continue;
      }

      if (entry.endsWith(".md")) {
        const instructions = await fs.readFile(p, "utf8");
        skills.push({
          name: path.basename(entry, ".md"),
          description: `Workspace skill loaded from ${entry}`,
          version: "1.0.0",
          activationRules: [],
          instructions,
          requiredTools: [],
        });
      }
    }

    return skills;
  }
}

