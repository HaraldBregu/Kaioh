# Agentic AI System Instructions

## 1. Purpose

This project should implement an agentic AI runtime that can receive messages, reason over user goals, call tools, use skills, persist state, and operate through gateway APIs. The system should support local-first agent execution while keeping every agent isolated from other agents by default.

The implementation should prioritize:

- Extensible agent capabilities through tools and skills.
- Isolated workspaces for agent-owned files and memory.
- Configurable model providers.
- Gateway access through WebSocket and HTTP APIs.
- Scheduled and proactive execution through cron jobs and heartbeat events.
- Clear boundaries between runtime orchestration, provider clients, tools, storage, and transport adapters.

## 2. Core Architecture

The system should be organized around a small set of explicit runtime components:

- Agent runtime: owns the reasoning loop, model calls, tool execution, skill loading, and event handling.
- Tool registry: exposes safe, typed tools that the agent can call.
- Skill registry: loads reusable instructions, workflows, and capability packs for the agent.
- Workspace manager: creates and enforces isolated per-agent storage.
- Gateway layer: exposes WebSocket and HTTP APIs for external clients.
- Scheduler: runs cron jobs and one-shot delayed tasks.
- Heartbeat service: periodically wakes agents for proactive checks.
- Model provider layer: abstracts OpenAI-compatible, local, and third-party model providers behind one interface.
- Configuration layer: validates all runtime, gateway, provider, scheduler, and workspace settings.

The architecture should keep domain/runtime behavior separate from external infrastructure. Gateways, model SDKs, file storage, and channel adapters should be adapters around the core agent runtime rather than hard dependencies inside it.

## 3. Agent Runtime

The agent runtime should implement a loop that accepts an input event, builds execution context, calls a configured model, handles tool calls, persists useful state, and returns an output event.

The runtime should support these event sources:

- Direct HTTP request.
- WebSocket client message.
- Cron scheduler event.
- Heartbeat event.
- Future channel adapters such as Telegram, Slack, Discord, email, or CLI.

The runtime should treat all inputs as normalized agent events with a common shape:

```ts
interface AgentEvent {
  id: string;
  agentId: string;
  source: "http" | "websocket" | "cron" | "heartbeat" | "channel";
  conversationId?: string;
  userId?: string;
  text: string;
  metadata?: Record<string, unknown>;
  createdAt: string;
}
```

The runtime should return normalized outputs:

```ts
interface AgentResponse {
  eventId: string;
  agentId: string;
  conversationId?: string;
  text: string;
  toolCalls?: ToolCallRecord[];
  createdAt: string;
}
```

## 4. Tools

The system should implement basic filesystem tools first, then expand to additional tool packs. Tools should be registered through a common interface with a name, description, schema, and executor.

Initial filesystem tools should include:

- `read_file`: read a file inside the agent workspace.
- `write_file`: write a file inside the agent workspace.
- `list_files`: list files and directories inside the agent workspace.
- `delete_file`: delete a file inside the agent workspace when policy allows it.
- `create_directory`: create a directory inside the agent workspace.
- `move_file`: move or rename a file inside the agent workspace.

Filesystem tools must enforce workspace isolation. They should reject paths that escape the agent workspace, including `..` traversal, absolute paths outside the workspace, and symlink escapes.

Tool execution should record:

- Tool name.
- Validated arguments.
- Execution result.
- Start and finish timestamps.
- Error details when execution fails.
- Whether the tool changed workspace state.

## 5. Skills

Skills should provide reusable agent behavior. A skill can contain instructions, examples, constraints, prompts, and optional tool requirements. The runtime should load skills explicitly from configuration or dynamically when an agent asks to use a named skill.

Each skill should define:

- Name.
- Description.
- Version.
- Activation rules.
- Instructions.
- Required tools.
- Optional configuration.

Example skill shape:

```ts
interface AgentSkill {
  name: string;
  description: string;
  version: string;
  activationRules: string[];
  instructions: string;
  requiredTools?: string[];
  configSchema?: Record<string, unknown>;
}
```

Skills should not bypass runtime policy. If a skill requires a tool that is not available to the agent, the runtime should either reject the skill or load it in a degraded mode with clear diagnostics.

## 6. Isolated Agent Workspace

Each agent should have an isolated workspace where it can store files, memory, task artifacts, generated content, schedules, and local state.

The default workspace layout should be:

```text
workspace/
  agents/
    <agent-id>/
      files/
      memory/
      skills/
      sessions/
      schedules/
      logs/
```

The workspace manager should:

- Create an agent workspace during agent initialization.
- Resolve all filesystem tool paths relative to the agent workspace.
- Prevent access to files owned by other agents unless explicitly configured.
- Seed default memory or instruction files when an agent is created.
- Support export and backup of one agent workspace without exposing others.

The agent should be allowed to persist useful local data in its workspace, but workspace writes should be observable and auditable.

## 7. Gateway APIs

The project should expose both HTTP and WebSocket gateway APIs.

The HTTP API should support request-response interactions for clients that submit a message and wait for a final response.

Recommended HTTP endpoints:

- `POST /api/agents/:agentId/messages`: submit a message and receive the final response.
- `GET /api/agents/:agentId/sessions/:sessionId`: read session history.
- `GET /api/agents/:agentId/workspace/files`: list workspace files.
- `GET /api/agents/:agentId/workspace/files/*`: read a workspace file.
- `POST /api/agents/:agentId/schedules`: create a scheduled task.
- `GET /api/agents/:agentId/schedules`: list scheduled tasks.
- `DELETE /api/agents/:agentId/schedules/:scheduleId`: remove a scheduled task.
- `GET /api/health`: service health check.

The WebSocket API should support streaming, long-running tool execution, status updates, and bidirectional agent sessions.

Recommended WebSocket events:

- `agent.message`: client sends a user message.
- `agent.delta`: server streams partial assistant output.
- `agent.tool_call`: server reports a tool call request.
- `agent.tool_result`: server reports a tool result.
- `agent.response`: server sends the final response.
- `agent.error`: server sends a structured error.
- `agent.heartbeat`: server reports heartbeat activity.

All gateway inputs should be validated before reaching the agent runtime.

## 8. Model Providers

The agent should be able to use many model providers. Providers should be configured, selected, and swapped without changing the agent loop.

The provider layer should support:

- OpenAI-compatible chat completion APIs.
- Provider-specific base URLs.
- Provider-specific API keys.
- Default model per provider.
- Per-agent model selection.
- Fallback provider chains.
- Optional limits such as max tokens, temperature, timeout, and retry count.

Recommended configuration shape:

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

Provider secrets should never be committed to the repository. Configuration should reference environment variable names or a secrets manager.

## 9. Cron Scheduler

The system should include a scheduler that can create, list, remove, enable, disable, and execute scheduled agent events.

The scheduler should support:

- One-shot schedules such as `in:5m`.
- Fixed intervals such as `interval:3600`.
- Standard cron expressions.
- Per-agent schedules.
- Persistent schedule storage.
- Recovery after process restart.
- Failed job logging.

Scheduled jobs should enqueue normalized `AgentEvent` objects into the runtime. The scheduler should not contain model or tool execution logic itself.

## 10. Heartbeat

The heartbeat service should periodically wake an agent so it can inspect its workspace, reminders, memory, schedules, or configured goals.

Heartbeat configuration should support:

- Enable or disable heartbeat globally.
- Enable or disable heartbeat per agent.
- Interval.
- Active hours.
- Target channel or gateway session.
- Heartbeat prompt or workspace file.

Heartbeat events should be handled by the same agent runtime as user messages. If no user-facing action is needed, the agent should be able to return a no-op response that is not sent to external clients.

## 11. Configuration

All runtime behavior should be configured through a validated configuration layer. Configuration should include:

- Gateway host, port, and authentication settings.
- Model providers and defaults.
- Agent definitions.
- Workspace root.
- Enabled tools.
- Enabled skills.
- Cron settings.
- Heartbeat settings.
- Logging and retention settings.

Invalid configuration should fail early with actionable errors.

## 12. Security and Policy

The system should assume all external inputs are untrusted.

Minimum security requirements:

- Authenticate HTTP and WebSocket gateway clients.
- Validate all request bodies.
- Enforce per-agent workspace boundaries.
- Avoid exposing raw provider keys to tools or prompts.
- Log sensitive values only in redacted form.
- Require explicit configuration before enabling dangerous tools such as shell execution.
- Apply rate limits to gateway endpoints.
- Record audit logs for mutating tool calls.

Tool policy should be centralized so new tools inherit the same validation and authorization checks.

## 13. Observability

The system should expose enough runtime data to debug agent behavior without leaking secrets.

Recommended logs and metrics:

- Agent event received.
- Model provider selected.
- Model request duration.
- Tool call start, success, failure, and duration.
- Workspace file mutations.
- Cron job creation and execution.
- Heartbeat execution.
- Gateway connection lifecycle.
- Structured errors with stable error codes.

Logs should include IDs for agent, event, session, schedule, and request correlation.

## 14. Implementation Order

Recommended implementation order:

1. Define shared runtime types for agents, events, responses, tools, skills, and model providers.
2. Add the workspace manager with strict path isolation.
3. Expand filesystem tools to list, create directory, move, and delete files.
4. Introduce a model provider abstraction and move provider configuration out of the agent loop.
5. Add HTTP API endpoints around the existing agent runtime.
6. Add WebSocket sessions with streaming event support.
7. Normalize cron and heartbeat events into the same `AgentEvent` pipeline.
8. Add skill loading and skill activation rules.
9. Add configuration validation for providers, gateway, tools, skills, cron, and heartbeat.
10. Add audit logs and focused tests around workspace isolation, tool execution, scheduling, and gateway validation.

## 15. Acceptance Criteria

The first complete version should satisfy these criteria:

- An agent can receive a message through HTTP.
- An agent can receive a message through WebSocket.
- The agent can call basic filesystem tools.
- Filesystem tools cannot access paths outside the agent workspace.
- The agent can persist data inside its isolated workspace.
- The agent can load configured skills.
- The agent can use a configured model provider.
- Multiple providers can be configured without code changes.
- A cron job can trigger an agent event.
- A heartbeat can trigger an agent event.
- Gateway requests are validated and authenticated.
- Tool calls and scheduled events are logged.

