import OpenAI from "openai";
import chalk from "chalk";
import { marked } from "marked";
import { markedTerminal } from "marked-terminal";
import type { Tool } from "../tools/base.js";
import type {
  ChatCompletionMessageParam,
  ChatCompletionTool,
  ChatCompletionMessageToolCall,
} from "openai/resources/chat/completions";

export const MODEL = "gpt-5.4";
const MAX_ITERATIONS = 20;

marked.use(markedTerminal() as any);

export const client = new OpenAI({
  apiKey: process.env.OPENROUTER_API_KEY,
});

function fmtArgs(args: Record<string, unknown>): string {
  return Object.entries(args)
    .map(([k, v]) => `${chalk.dim(`${k}=`)}${chalk.white(String(v).slice(0, 60))}`)
    .join("  ");
}

function panel(title: string, body: string, color: "green" | "red"): string {
  const c = color === "green" ? chalk.green : chalk.red;
  const line = c("─".repeat(60));
  return `${c("┌─")} ${chalk.bold(c(title))} ${line}\n${body}\n${c("└")}${line}`;
}

export interface RunResult {
  text: string;
  newMessages: ChatCompletionMessageParam[];
}

export async function runAgent(
  userMessage: string,
  tools: Tool[],
  history: ChatCompletionMessageParam[] = [],
  systemPrompt?: string,
): Promise<RunResult> {
  const toolMap = new Map(tools.map((t) => [t.name, t]));
  const toolSchemas = tools.map((t) => t.schema() as ChatCompletionTool);

  const messages: ChatCompletionMessageParam[] = [];
  if (systemPrompt) messages.push({ role: "system", content: systemPrompt });
  messages.push(...history);
  if (userMessage) messages.push({ role: "user", content: userMessage });

  const newMessages: ChatCompletionMessageParam[] = [];
  if (userMessage) newMessages.push({ role: "user", content: userMessage });

  for (let i = 0; i < MAX_ITERATIONS; i++) {
    const response = await client.chat.completions.create({
      model: MODEL,
      messages,
      tools: toolSchemas.length ? toolSchemas : undefined,
    });

    const msg = response.choices[0].message;

    const assistantMsg: ChatCompletionMessageParam = {
      role: "assistant",
      content: msg.content ?? "",
    };
    if (msg.tool_calls && msg.tool_calls.length) {
      (assistantMsg as any).tool_calls = msg.tool_calls.map((tc: ChatCompletionMessageToolCall) => ({
        id: tc.id,
        type: "function",
        function: {
          name: tc.function.name,
          arguments: tc.function.arguments,
        },
      }));
    }

    messages.push(assistantMsg);
    newMessages.push(assistantMsg);

    if (!msg.tool_calls || msg.tool_calls.length === 0) {
      const text = msg.content ?? "";
      const rendered = (await marked.parse(text)).toString().trimEnd();
      console.log(panel("assistant", rendered, "green"));
      return { text, newMessages };
    }

    for (const tc of msg.tool_calls) {
      const fnName = tc.function.name;
      let fnArgs: Record<string, unknown> = {};
      try {
        fnArgs = JSON.parse(tc.function.arguments);
      } catch {
        fnArgs = {};
      }

      console.log(`  ${chalk.bold.magenta(`⚡ ${fnName}`)}  ${fmtArgs(fnArgs)}`);

      const tool = toolMap.get(fnName);
      const result = tool ? await tool.execute(fnArgs) : `Error: unknown tool '${fnName}'`;

      const preview = result.length > 50 ? result.slice(0, 50) + "..." : result;
      console.log(`  ${chalk.green("✓")} ${chalk.dim(preview)}\n`);

      const toolResultMsg: ChatCompletionMessageParam = {
        role: "tool",
        tool_call_id: tc.id,
        content: result,
      };
      messages.push(toolResultMsg);
      newMessages.push(toolResultMsg);
    }
  }

  const error = "Error: max iterations reached";
  console.log(panel("error", error, "red"));
  return { text: error, newMessages };
}
