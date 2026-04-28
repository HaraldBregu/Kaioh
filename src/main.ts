import readline from "node:readline/promises";
import chalk from "chalk";
import { buildSystemPrompt } from "./agent/context.js";
import { runAgent } from "./agent/loop.js";
import { MemoryManager } from "./agent/memory.js";
import { SessionManager } from "./session/manager.js";
import { ExecTool } from "./tools/exec.js";
import { ReadFileTool, WriteFileTool } from "./tools/filesystem.js";

async function main(): Promise<void> {
  if (!process.env.OPENROUTER_API_KEY) {
    console.error("Error: OPENROUTER_API_KEY env var not set");
    process.exit(1);
  }

  const memory = new MemoryManager();
  await memory.init();

  const session = new SessionManager("cli:default");
  await session.init();
  const history = await session.load();

  const tools = [new ReadFileTool(), new WriteFileTool(), new ExecTool()];
  const systemPrompt = await buildSystemPrompt(memory);

  // Single-shot mode
  const argv = process.argv.slice(2);
  if (argv.length > 0) {
    const userMessage = argv.join(" ");
    const { newMessages } = await runAgent(userMessage, tools, history, systemPrompt);
    await session.append(newMessages);
    return;
  }

  // Interactive loop
  console.log(`${chalk.bold("AI Assistant")} — type ${chalk.dim("exit")} or ${chalk.dim("quit")} to stop\n`);
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

  while (true) {
    let userInput: string;
    try {
      userInput = (await rl.question(`${chalk.bold.cyan("you")} `)).trim();
    } catch {
      console.log(chalk.dim("\nGoodbye."));
      break;
    }

    if (!userInput) continue;
    if (userInput.toLowerCase() === "exit" || userInput.toLowerCase() === "quit") {
      console.log(chalk.dim("Goodbye."));
      break;
    }

    const { newMessages } = await runAgent(userInput, tools, history, systemPrompt);
    await session.append(newMessages);
    history.push(...newMessages);
    console.log();
  }

  rl.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
