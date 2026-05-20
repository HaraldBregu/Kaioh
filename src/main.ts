import readline from "node:readline/promises";
import chalk from "chalk";
import { loadConfig } from "./config/schema.js";
import { CronService } from "./cron/service.js";
import { createProviderRegistry } from "./providers/factory.js";
import { AgentRuntime, workspaceCronPath } from "./runtime/agent-runtime.js";
import { AsyncQueue, type AgentEvent } from "./types.js";
import { WorkspaceManager } from "./workspace/manager.js";

async function main(): Promise<void> {
  const config = await loadConfig();
  const workspaceManager = new WorkspaceManager(config.workspace.root);
  const providers = createProviderRegistry(config.models);
  const queue = new AsyncQueue<AgentEvent>();
  const cron = new CronService(queue, workspaceCronPath(config.workspace.root), config.cron.poll_interval_ms);
  await cron.load();

  const runtime = new AgentRuntime({
    config,
    workspaceManager,
    providers,
    cron,
  });

  const agentId = "default";
  const conversationId = "cli:default";

  const argv = process.argv.slice(2);
  if (argv.length > 0) {
    await runtime.handleEvent(
      runtime.makeEvent({
        agentId,
        source: "channel",
        conversationId,
        text: argv.join(" "),
        metadata: { channel: "cli" },
      }),
    );
    return;
  }

  console.log(`${chalk.bold("AI Assistant")} - type ${chalk.dim("exit")} or ${chalk.dim("quit")} to stop\n`);
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

    await runtime.handleEvent(
      runtime.makeEvent({
        agentId,
        source: "channel",
        conversationId,
        text: userInput,
        metadata: { channel: "cli" },
      }),
    );
    console.log();
  }

  rl.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

