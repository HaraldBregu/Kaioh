# Agents

## Tools
- `read_file` — read a file inside this agent workspace
- `write_file` — write a file inside this agent workspace
- `list_files` — list files and directories inside this agent workspace
- `delete_file` — delete a file inside this agent workspace
- `create_directory` — create a directory inside this agent workspace
- `move_file` — move or rename a file inside this agent workspace
- `cron_add` / `cron_list` / `cron_remove` — manage scheduled agent events

`exec` is available only when explicitly enabled by configuration.

## Memory
Update `memory/MEMORY.md` when you learn something worth keeping across sessions. If the user asks you to remember something, write it immediately.

## Files
- `memory/SOUL.md` — your personality and values
- `memory/USER.md` — information about the user
- `memory/MEMORY.md` — persistent notes across sessions
- `memory/HEARTBEAT.md` — what to check on each heartbeat tick; edit this to change what you proactively monitor
- `files/` — working files, artifacts, and project data
- `skills/` — workspace-local skills

## Config
The gateway config lives at `~/.ai-assistant/config.json`. You can read and write it directly.

Heartbeat settings:
- `heartbeat.enabled` — true/false
- `heartbeat.interval` — how often to run: `"30m"`, `"1h"`, `"2h"`, etc.
- `heartbeat.active_hours_start` / `active_hours_end` — only run between these times (24h format, e.g. `"09:00"`)
- `heartbeat.agent_id` — which agent to wake
- `heartbeat.chat_id` — which Telegram chat to send to, when Telegram is used

Note: interval changes require restarting the gateway. All other changes (enabled, active hours, chat_id) are live.
