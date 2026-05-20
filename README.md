# Kaioh

Local CLI-first AI agent runtime with isolated workspaces, tool calling, skills, configurable model providers, and cron/heartbeat automation. HTTP/WebSocket gateway APIs and Telegram remain available as optional adapters.

## Layout

```text
Kaioh/
├── src/
│   ├── main.ts                # CLI entry
│   ├── gateway.ts             # HTTP/WebSocket/Telegram/Cron/Heartbeat composition root
│   ├── types.ts               # AgentEvent, AgentResponse, ToolCallRecord, AsyncQueue
│   ├── agent/                 # system prompt + tool-calling loop
│   ├── audit/                 # per-agent JSONL audit logging
│   ├── channels/              # Telegram adapter
│   ├── config/                # zod config validation + default config
│   ├── cron/                  # persistent scheduler
│   ├── http/                  # HTTP routes + minimal WebSocket transport
│   ├── providers/             # configurable model provider abstraction
│   ├── runtime/               # normalized agent runtime
│   ├── session/               # per-agent JSONL sessions
│   ├── skills/                # skill loading
│   ├── tools/                 # filesystem, cron, optional exec tools
│   └── workspace/             # isolated workspace manager
├── docs/
│   └── agentic-ai-system.md
├── workspace-templates/
├── package.json
└── tsconfig.json
```

## Runtime Model

All inputs are normalized into `AgentEvent` objects and handled by the same runtime:

- HTTP requests.
- WebSocket messages.
- Cron events.
- Heartbeat events.
- Channel events such as Telegram or CLI.

Each agent gets an isolated workspace:

```text
~/.ai-assistant/workspace/
  agents/
    <agent-id>/
      files/
      memory/
      skills/
      sessions/
      schedules/
      logs/
```

Filesystem tools resolve paths inside that agent root and reject path traversal or symlink escapes.

## Tools

Enabled by default:

- `read_file`
- `write_file`
- `list_files`
- `delete_file`
- `create_directory`
- `move_file`
- `cron_add`
- `cron_list`
- `cron_remove`

`exec` is available only when `tools.enable_exec` is explicitly set to `true` in config.

## Gateway API

Start the gateway:

```bash
npm run dev:gateway
```

Default URL:

```text
http://127.0.0.1:8787
```

HTTP endpoints:

- `GET /api/health`
- `POST /api/agents/:agentId/messages`
- `GET /api/agents/:agentId/sessions/:sessionId`
- `GET /api/agents/:agentId/workspace/files?path=.`
- `GET /api/agents/:agentId/workspace/files/*`
- `POST /api/agents/:agentId/schedules`
- `GET /api/agents/:agentId/schedules`
- `DELETE /api/agents/:agentId/schedules/:scheduleId`

WebSocket endpoint:

```text
ws://127.0.0.1:8787/api/ws
```

Send:

```json
{
  "type": "agent.message",
  "agentId": "default",
  "text": "List my workspace files"
}
```

The server emits `gateway.ready`, `agent.tool_call`, `agent.tool_result`, `agent.response`, and `agent.error` events.

## Configuration

`~/.ai-assistant/config.json` is created and normalized on first run.

Model providers are configured without changing the agent loop:

```json
{
  "models": {
    "defaultProvider": "openrouter",
    "providers": {
      "openrouter": {
        "type": "openai-compatible",
        "baseUrl": "https://openrouter.ai/api/v1",
        "apiKeyEnv": "OPENROUTER_API_KEY",
        "defaultModel": "gpt-5.4"
      },
      "openai": {
        "type": "openai",
        "apiKeyEnv": "OPENAI_API_KEY",
        "defaultModel": "gpt-5.4"
      }
    }
  }
}
```

Gateway auth uses the token in `gateway.auth_token_env`. If that env var is unset, local unauthenticated requests are allowed only when `gateway.allow_unauthenticated_localhost` is `true`.

## Run

```bash
npm install

# CLI single-shot
npm run dev -- "list files in my workspace"

# CLI interactive REPL
npm run dev

# HTTP/WebSocket gateway plus optional Telegram, heartbeat, and cron
npm run dev:gateway

# Type check and production build
npm run typecheck
npm run build
```

Set the provider key before using the agent:

```bash
export OPENROUTER_API_KEY=your_key_here
```
