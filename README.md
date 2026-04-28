# Kaioh

Proactive AI assistant. Agent wakes on a schedule, checks a workspace checklist, and messages the user without being asked. Users can also schedule future tasks via natural language. Telegram gateway + persistent sessions.

## Layout

```
Kaioh/
├── src/
│   ├── main.ts              # CLI entry (single-shot + interactive REPL)
│   ├── gateway.ts           # Telegram gateway, message/heartbeat/cron tasks
│   ├── types.ts             # AsyncQueue + InboundMessage
│   ├── agent/
│   │   ├── context.ts       # build_system_prompt
│   │   ├── loop.ts          # tool-calling agent loop
│   │   └── memory.ts        # workspace seeding from templates
│   ├── channels/
│   │   └── telegram.ts      # grammy adapter, allow-list gate
│   ├── config/
│   │   └── schema.ts        # zod config + auto-create
│   ├── cron/
│   │   └── service.ts       # CronService (in:/interval:/cron expr)
│   ├── session/
│   │   └── manager.ts       # jsonl per-chat history
│   └── tools/
│       ├── base.ts          # Tool abstract class
│       ├── exec.ts          # shell exec with dangerous-pattern guard
│       ├── filesystem.ts    # read_file, write_file
│       └── cron.ts          # cron_add, cron_list, cron_remove
├── workspace-templates/     # seeded into ~/.ai-assistant/workspace on first run
├── package.json
├── tsconfig.json
└── README.md
```

## How it works

**Heartbeat** — background loop wakes every N minutes, reads `HEARTBEAT.md` from workspace, injects it as automated message. Agent acts or returns `HEARTBEAT_OK` to suppress output silently.

**Cron** — `CronService` runs alongside message loop. LLM schedules jobs via `cron_add`:
- `in:5m` — one-shot, fires once after 5 minutes
- `interval:3600` — recurring every N seconds
- `0 9 * * *` — standard cron expression

Messages, heartbeat, and cron all funnel through one shared inbound queue handled by the same message loop.

## Stack

| Concern               | Library                              |
|-----------------------|--------------------------------------|
| LLM client            | `openai` SDK + OpenRouter `baseURL`  |
| Telegram              | `grammy`                             |
| Cron parsing          | `cron-parser`                        |
| Config validation     | `zod`                                |
| Terminal output       | `chalk` + `marked-terminal`          |
| UUIDs                 | `node:crypto.randomUUID`             |

## Setup

```bash
cd Kaioh
npm install
export OPENROUTER_API_KEY=your_key_here
```

`~/.ai-assistant/config.json` is auto-created on first gateway run. Edit to fill in:

```json
{
  "telegram": {
    "bot_token": "YOUR_BOT_TOKEN",
    "allow_from": ["YOUR_TELEGRAM_USER_ID"]
  },
  "heartbeat": {
    "enabled": true,
    "interval": "30m",
    "active_hours_start": "07:00",
    "active_hours_end": "22:00",
    "channel": "telegram",
    "chat_id": "YOUR_TELEGRAM_USER_ID"
  }
}
```

Get a bot token from `@BotFather` on Telegram. Find your user ID via `@userinfobot`.

## Run

```bash
# CLI single-shot
npm run dev -- "list files in workspace"

# CLI interactive REPL
npm run dev

# Telegram gateway (heartbeat + cron + chat)
npm run dev:gateway

# Production build
npm run build
npm run gateway        # runs dist/gateway.js
npm start              # runs dist/main.js

# Type check only
npm run typecheck
```

## Persistence paths

- `~/.ai-assistant/workspace/` — seeded markdown files the agent edits
- `~/.ai-assistant/sessions/<channel>:<chat_id>.jsonl` — per-chat history
- `~/.ai-assistant/cron.json` — scheduled jobs
- `~/.ai-assistant/config.json` — telegram + heartbeat config
