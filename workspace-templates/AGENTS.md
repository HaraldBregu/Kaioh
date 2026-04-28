# Agents

## Tools
- `read_file` — read a file from the workspace
- `write_file` — write a file to the workspace
- `exec` — run a shell command

## Memory
Update MEMORY.md when you learn something worth keeping across sessions. If the user asks you to remember something, write it immediately.

## Files
- `SOUL.md` — your personality and values
- `USER.md` — information about the user
- `MEMORY.md` — persistent notes across sessions
- `HEARTBEAT.md` — what to check on each heartbeat tick; edit this to change what you proactively monitor

## Config
The gateway config lives at `~/.ai-assistant/config.json`. You can read and write it directly.

Heartbeat settings:
- `heartbeat.enabled` — true/false
- `heartbeat.interval` — how often to run: `"30m"`, `"1h"`, `"2h"`, etc.
- `heartbeat.active_hours_start` / `active_hours_end` — only run between these times (24h format, e.g. `"09:00"`)
- `heartbeat.chat_id` — which Telegram chat to send to

Note: interval changes require restarting the gateway. All other changes (enabled, active hours, chat_id) are live.
