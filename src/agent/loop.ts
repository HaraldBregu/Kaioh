import { randomUUID } from "node:crypto";
import chalk from "chalk";
import { marked } from "marked";
import { markedTerminal } from "marked-terminal";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";
import type { AuditLogger } from "../audit/logger.js";
import type { ChatModelProvider } from "../providers/base.js";
import type { ToolCallRecord } from "../types.js";
import type { Tool, ToolExecutionContext } from "../tools/base.js";

const MAX_ITERATIONS = 20;

marked.use(markedTerminal() as any);

function fmtArgs(args: Record<string, unknown>): string {
  return Object.entries(args)
    .map(([k, v]) => `${chalk.dim(`${k}=`)}${chalk.white(String(v).slice(0, 60))}`)
    .join("  ");
}

function panel(title: string, body: string, color: "green" | "red"): string {
  const c = color === "green" ? chalk.green : chalk.red;
  const line = c("-".repeat(60));
  return `${c("+-")} ${chalk.bold(c(title))} ${line}\n${body}\n${c("+")}${line}`;
}

export interface RunResult {
  text: string;
  newMessages: ChatCompletionMessageParam[];
  toolCalls: ToolCallRecord[];
}

export interface RunAgentCallbacks {
  onToolCallStart?: (data: { id: string; name: string; args: Record<string, unknown> }) => void | Promise<void>;
  onToolCallResult?: (record: ToolCallRecord) => void | Promise<void>;
  onDelta?: (delta: string) => void | Promise<void>;
}

export interface RunAgentOptions {
  userMessage: string;
  tools: Tool[];
  history?: ChatCompletionMessageParam[];
  systemPrompt?: string;
  provider: ChatModelProvider;
  model?: string;
  toolContext: ToolExecutionContext;
  auditLogger?: AuditLogger;
  callbacks?: RunAgentCallbacks;
}

interface ResolvedTurn {
  content: string;
  toolCalls?: Array<{ id: string; type: "function"; function: { name: string; arguments: string } }>;
}

async function callProvider(
  provider: ChatModelProvider,
  request: Parameters<ChatModelProvider["createChatCompletion"]>[0],
  onDelta?: (delta: string) => void | Promise<void>,
): Promise<ResolvedTurn> {
  if (onDelta && provider.createChatCompletionStream) {
    let content = "";
    const accumulated = new Map<number, { id: string; name: string; args: string }>();

    for await (const delta of provider.createChatCompletionStream(request)) {
      if (delta.content) {
        content += delta.content;
        await onDelta(delta.content);
      }
      if (delta.toolCallDeltas) {
        for (const tc of delta.toolCallDeltas) {
          const existing = accumulated.get(tc.index) ?? { id: "", name: "", args: "" };
          if (tc.id) existing.id = tc.id;
          if (tc.name) existing.name += tc.name;
          if (tc.args) existing.args += tc.args;
          accumulated.set(tc.index, existing);
        }
      }
    }

    const toolCalls =
      accumulated.size > 0
        ? Array.from(accumulated.entries())
            .sort(([a], [b]) => a - b)
            .map(([, tc]) => ({
              id: tc.id,
              type: "function" as const,
              function: { name: tc.name, arguments: tc.args },
            }))
        : undefined;

    return { content, toolCalls };
  }

  const response = await provider.createChatCompletion(request);
  const msg = response.choices[0]?.message;
  if (!msg) throw new Error("model returned no message");

  return {
    content: msg.content ?? "",
    toolCalls: msg.tool_calls?.map((tc) => ({
      id: tc.id,
      type: "function" as const,
      function: { name: tc.function.name, arguments: tc.function.arguments },
    })),
  };
}

export async function runAgent(options: RunAgentOptions): Promise<RunResult> {
  const toolMap = new Map(options.tools.map((t) => [t.name, t]));
  const toolSchemas = options.tools.map((t) => t.schema());

  const messages: ChatCompletionMessageParam[] = [];
  if (options.systemPrompt) messages.push({ role: "system", content: options.systemPrompt });
  messages.push(...(options.history ?? []));
  if (options.userMessage) messages.push({ role: "user", content: options.userMessage });

  const newMessages: ChatCompletionMessageParam[] = [];
  const toolCalls: ToolCallRecord[] = [];
  if (options.userMessage) newMessages.push({ role: "user", content: options.userMessage });

  for (let i = 0; i < MAX_ITERATIONS; i++) {
    let turn: ResolvedTurn;
    try {
      turn = await callProvider(
        options.provider,
        { model: options.model, messages, tools: toolSchemas.length ? toolSchemas : undefined },
        options.callbacks?.onDelta,
      );
    } catch (e) {
      const error = `Error: ${(e as Error).message}`;
      console.log(panel("error", error, "red"));
      return { text: error, newMessages, toolCalls };
    }

    const assistantMsg: ChatCompletionMessageParam = { role: "assistant", content: turn.content };
    if (turn.toolCalls?.length) {
      (assistantMsg as any).tool_calls = turn.toolCalls;
    }

    messages.push(assistantMsg);
    newMessages.push(assistantMsg);

    if (!turn.toolCalls?.length) {
      const text = turn.content;
      const rendered = (await marked.parse(text)).toString().trimEnd();
      console.log(panel("assistant", rendered, "green"));
      return { text, newMessages, toolCalls };
    }

    for (const tc of turn.toolCalls) {
      const fnName = tc.function.name;
      let fnArgs: Record<string, unknown> = {};
      try {
        fnArgs = JSON.parse(tc.function.arguments) as Record<string, unknown>;
      } catch {
        fnArgs = {};
      }

      const recordId = randomUUID();
      const startedAt = new Date().toISOString();
      await options.callbacks?.onToolCallStart?.({ id: recordId, name: fnName, args: fnArgs });

      console.log(`  ${chalk.bold.magenta(`* ${fnName}`)}  ${fmtArgs(fnArgs)}`);

      const tool = toolMap.get(fnName);
      const result = tool
        ? await tool.execute(fnArgs, options.toolContext)
        : { content: `Error: unknown tool '${fnName}'`, error: "unknown_tool" };

      const finishedAt = new Date().toISOString();
      const record: ToolCallRecord = {
        id: recordId,
        eventId: options.toolContext.eventId,
        agentId: options.toolContext.agentId,
        conversationId: options.toolContext.conversationId,
        toolName: fnName,
        args: fnArgs,
        result: result.content,
        startedAt,
        finishedAt,
        changedWorkspace: result.changedWorkspace ?? false,
        error: result.error,
      };
      toolCalls.push(record);
      await options.auditLogger?.toolCall(record);
      await options.callbacks?.onToolCallResult?.(record);

      const preview = result.content.length > 50 ? result.content.slice(0, 50) + "..." : result.content;
      console.log(`  ${result.error ? chalk.red("x") : chalk.green("v")} ${chalk.dim(preview)}\n`);

      const toolResultMsg: ChatCompletionMessageParam = {
        role: "tool",
        tool_call_id: tc.id,
        content: result.content,
      };
      messages.push(toolResultMsg);
      newMessages.push(toolResultMsg);
    }
  }

  const error = "Error: max iterations reached";
  console.log(panel("error", error, "red"));
  return { text: error, newMessages, toolCalls };
}

