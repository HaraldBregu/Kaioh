import { MemoryManager } from "./memory.js";

export async function buildSystemPrompt(
  memory: MemoryManager,
  channel?: string,
  chat_id?: string,
): Promise<string> {
  const now = new Date().toISOString().replace("T", " ").slice(0, 16) + " UTC";
  const parts = [
    "You are a personal AI assistant.",
    `Current date/time: ${now}`,
    `Workspace: ${memory.workspace}`,
    `Always use absolute paths when reading or writing files. Your workspace is ${memory.workspace}.`,
  ];
  if (channel) parts.push(`Channel: ${channel}`);
  if (chat_id) parts.push(`Chat ID: ${chat_id}`);

  const sections = [parts.join("\n")];
  const all = await memory.readAll();
  for (const [tag, content] of Object.entries(all)) {
    sections.push(`<${tag}>\n${content}\n</${tag}>`);
  }
  return sections.join("\n\n");
}
