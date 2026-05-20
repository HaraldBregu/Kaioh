# Agentic AI Implementation Instructions

## 1. Purpose

OpenArmy should first become a minimal AI assistant runtime with basic filesystem tools, a file parsing tool, and a web scraping tool, then evolve from a CLI tool manager into an agentic AI runtime that can run configurable agents with tools, skills, isolated workspaces, model providers, an HTTP API gateway, scheduling, heartbeat monitoring, and multi-agent orchestration.

The minimal assistant should be runnable through three separate entry modules: a CLI, a Node.js module API, and an HTTP server. These entry modules should share the same core runtime implementation instead of duplicating agent execution, workspace, tool, skill, or provider logic.

This document defines the first implementation direction. Treat each section as a requirement area that can be refined into tickets, architecture docs, and code changes.

## 2. Runtime Goals

The system should implement an agent runtime that can:

- Execute one or more agents concurrently.
- Track each agent run from creation to completion.
- Give every agent an isolated workspace for reading, writing, and persisting task data.
- Run through the CLI, an importable Node.js API, or the HTTP server using the same runtime core.
- Expose agent capabilities through an HTTP API.
- Support basic filesystem tools, a file parsing tool, a web scraping tool, and later other configurable tool groups.
- Support built-in skills and skills installed from the command line.
- Support multiple model providers with runtime configuration.
- Support cron-based scheduling and heartbeat health checks.

## 3. Installation and Bootstrap

The system should support installation on every target machine through a bootstrap script that can be executed with `curl`.

Example installation command:

```bash
curl -fsSL https://friday.example.com/install.sh | bash
```

For local development, the project should be executable with:

```bash
npm run dev
```

Running `npm run dev` should automatically create and start the local HTTP server for the agent runtime. The local development process should only start the HTTP server.

The installation script should:

- Detect the operating system and CPU architecture.
- Install or update the OpenArmy runtime.
- Create the required local directories.
- Initialize default configuration files.
- Register bundled tools and built-in skills.
- Validate that the CLI and runtime can start successfully.

The script should be idempotent so it can be safely re-run for upgrades or repairs.

The CLI should support installing or registering additional skills with:

```bash
oa skills -a "name of skill"
```

Installed skills should be persisted in the configured skill directory and made available to agents through the same `SkillRegistry` used by the CLI, Node.js API, and HTTP server.

## 4. Core Architecture

The first architecture should include these modules:

- `RuntimeCore`: composes the shared runtime services used by every entry module.
- `CliEntrypoint`: runs the assistant and management commands from the command line.
- `NodeRuntimeModule`: exposes the assistant runtime as an importable Node.js API.
- `AgentRuntime`: creates, starts, stops, resumes, and supervises agents.
- `AgentRegistry`: stores known agent definitions, versions, status, and metadata.
- `RunTracker`: records active, completed, failed, paused, and cancelled runs.
- `WorkspaceManager`: creates isolated per-agent and per-run workspaces.
- `ToolRegistry`: registers tool groups and controls which tools an agent can use.
- `SkillRegistry`: registers skills and resolves skill instructions/assets for an agent.
- `ModelProviderRegistry`: manages configured model providers and model selection.
- `HttpServer`: exposes the HTTP API and starts automatically in local development.
- `Scheduler`: runs agents on cron schedules.
- `HeartbeatMonitor`: records liveness and detects stalled agents.

Keep these boundaries explicit so the CLI, Node.js API, HTTP API, scheduler, and future UI can all use the same runtime services. The CLI, Node.js module, and HTTP server should be thin adapters over `RuntimeCore`; they must not implement separate agent execution logic.

## 5. Agent Definition

An agent definition should describe what an agent is allowed to do and how it runs.

Each agent should be configurable with:

- `id`: stable unique identifier.
- `name`: human-readable name.
- `description`: short purpose statement.
- `model`: default model selection.
- `provider`: default model provider.
- `tools`: allowed tool groups and tool-level permissions.
- `mcpServers`: allowed custom MCP servers and MCP tool permissions.
- `skills`: enabled skills.
- `workspacePolicy`: storage limits and isolation mode.
- `schedule`: optional cron configuration.
- `heartbeat`: optional liveness interval and timeout.
- `environment`: allowed environment variables or secrets references.
- `concurrency`: max parallel runs for this agent.

Agent definitions should be serializable so they can be stored in configuration files, a local registry, or later a database.

## 6. Tool Implementation

The minimal assistant should ship with a controlled tool system. The first usable implementation needs basic filesystem tools, one file parsing tool, and one web scraping tool. Tools should be selected through `tool_search`, then called only through `ToolRegistry`, which performs registration, schema validation, permission checks, execution, and audit logging.

The first implementation should include these necessary tools:

- `fs.readFile`: read the exact contents of a known workspace file when the assistant needs raw file text or bytes.
- `fs.writeFile`: create a new workspace file or fully replace an existing file when the desired final content is known.
- `fs.appendFile`: add content to the end of an existing workspace file without rewriting the rest of the file.
- `fs.applyPatch`: make targeted edits to an existing workspace file while preserving unrelated content.
- `fs.listDirectory`: inspect the immediate contents of a workspace directory to understand available files and folders.
- `fs.createDirectory`: create a missing workspace directory before writing files or artifacts into it.
- `fs.deleteFile`: remove a specific workspace file that is no longer needed.
- `fs.moveFile`: rename or relocate a workspace file while preserving its contents and metadata where possible.
- `fs.stat`: inspect metadata for a workspace path, such as existence, type, size, and modified time, without reading file contents.
- `fs.search`: find files or matching text across the workspace when the exact path or location is not known.
- `file.parse`: convert a workspace file or uploaded file into normalized assistant-readable content when raw file contents are not enough.
- `web.scrape`: fetch and extract content from a URL when the assistant needs information from a web page.

The `file.parse` tool should behave as a best-effort parser for arbitrary file inputs. It should detect file type from extension, MIME type, and content sniffing, then return normalized output such as text, metadata, page or sheet structure, extracted tables, and stored artifacts. Unsupported or unsafe file types should return a structured `unsupported_file_type` or `parse_failed` error instead of crashing the run.

The first parser implementation should support common assistant inputs:

- Plain text, Markdown, JSON, YAML, CSV, TSV, HTML, XML, and source code files.
- PDF files.
- Office-style documents and spreadsheets when a safe parser is available.
- Image metadata, with OCR treated as an optional later capability.

The `web.scrape` tool should behave as a focused web scraper, not a general browser automation tool. It should accept a URL and optional extraction settings, fetch the page, and return structured content such as title, final URL, status code, text content, selected links, metadata, and optional saved artifacts in the run workspace.

Each tool should define:

- Stable tool id.
- Human-readable name and a differentiating description.
- Input schema.
- Output schema.
- Permission requirements.
- Whether it mutates files.
- Whether it calls the network.
- Whether it can be used in parallel.
- Read and write size limits.
- Audit log metadata.

Tool descriptions should make tools easy to choose correctly. Each description should state what the tool is for, what makes it different from nearby tools, and when not to use it. For example, `fs.readFile` is for reading a known path, `fs.search` is for locating unknown paths or matches, and `file.parse` is for extracting structured content from a file format.

The first implementation should use these supporting services:

- `ToolSearch`: discovers and ranks available tools for the current task, including deferred, MCP, skill-required, or plugin-provided tools.
- `ToolRegistry`: stores tool definitions and executes tools by id.
- `ToolAuthorizer`: checks the current agent and run permissions before execution.
- `WorkspacePathGuard`: resolves, normalizes, and validates paths before filesystem access.
- `FileParserRegistry`: maps file types to safe parsers used by `file.parse`.
- `ToolAuditLogger`: records every mutating operation and failed authorization attempt.

Tool selection should follow this flow:

- Use `tool_search` to find candidate tools that match the current task and enabled skills.
- Filter candidate tools through the agent definition, run policy, MCP permissions, and network policy.
- Choose the least privileged tool that can complete the task.
- Execute the chosen tool through `ToolRegistry`; tools must not be invoked directly from agent logic.
- Record the search query, selected tool id, rejected candidate count, authorization decision, and execution result in run metadata.

Filesystem tools must not escape the assigned workspace unless an explicit administrator-level policy allows it.

Required safety rules:

- Resolve and normalize paths before access.
- Reject path traversal outside the workspace.
- Reject symlink escapes outside the workspace.
- Require explicit file parsing permission before `file.parse` can process uploaded or workspace files.
- Enforce parser input size limits, output size limits, and safe temporary directories for `file.parse`.
- Treat parser failures as structured tool results, not runtime crashes.
- Require explicit network permission before `web.scrape` can fetch a URL.
- Enforce allowed protocols, domain policy, timeouts, redirect limits, and response size limits for `web.scrape`.
- Do not execute arbitrary page scripts in the first web scraping implementation.
- Keep an audit log for mutating operations.
- Keep an audit log for network fetches, including URL, final URL, status code, content type, and byte count.
- Prefer patch-based edits for existing files.
- Enforce size limits on reads and writes.
- Redact secrets before writing logs.

Future tool groups such as shell commands, web search, image generation, browser automation, GitHub, Figma, and sub-agents should be added later as optional tool groups. They must not be available to the minimal assistant unless explicitly registered and allowed for the agent.

## 7. Skills Implementation

Skills should be reusable instruction packages that extend assistant behavior for a specific workflow or domain. Skills do not execute code by themselves; they provide instructions, references, templates, scripts, and metadata that the assistant may load during a run.

Use the Agent Skills format as the compatibility baseline: https://agentskills.io/home. OpenArmy can add runtime-specific metadata, but skills should remain portable folders centered on `SKILL.md`.

Skills can be bundled as built-in skills or installed from the command line. The CLI should support adding skills with:

```bash
oa skills -a "name of skill"
```

Built-in skills should live in the packaged runtime. Installed skills should be persisted in the configured skill directory and registered through the same `SkillRegistry` used by the CLI, Node.js API, and HTTP server.

Each skill should include:

- `SKILL.md`: required primary instructions with frontmatter metadata such as `name` and `description`.
- Optional `skill.json`: OpenArmy-specific metadata such as skill id, version, permissions, compatibility, and trigger overrides.
- Optional `references/`, `scripts/`, `templates/`, or `assets/` directories.
- Required tool permissions.
- Version metadata.

Skill loading should use progressive disclosure:

- Discovery: load only each allowed skill's name, description, and minimal metadata into the skill catalog.
- Activation: when the model or user selects a skill, load the full `SKILL.md` instructions.
- Execution: load scripts, references, templates, and assets only when the active skill explicitly needs them.

The skill catalog should hide unavailable skills instead of showing blocked skills to the model. A skill should be excluded when the user disabled it, the agent lacks permission, the skill is incompatible with the runtime, or the skill opts out of model-driven activation.

Skill activation should support both model-driven and user-explicit activation. Model-driven activation should let the assistant choose from the filtered skill catalog. User-explicit activation should support a clear command or mention syntax, such as `$skill-name`, resolved by the runtime before the model starts work.

When a skill activates, the runtime should return structured skill content that clearly separates the skill instructions from normal conversation. The activation result should include the skill name, skill directory, primary instructions, and a shallow list of bundled resources without eagerly reading every resource file.

Skill authoring best practices:

- Start from real expertise, working task traces, project artifacts, runbooks, code review comments, failure cases, and fixes.
- Scope each skill as one coherent unit of work that composes well with other skills.
- Add what the assistant would otherwise get wrong; omit generic knowledge the model already has.
- Prefer concise, stepwise guidance with one working example over exhaustive documentation.
- Include concrete gotchas, default tools or approaches, validation steps, and expected input/output formats.
- Provide defaults instead of menus of equal options.
- Use checklists for multi-step workflows and validation loops for fragile or repeatable work.
- Put large reference material in `references/` and tell the assistant exactly when to load it.
- Keep `SKILL.md` focused; target less than 500 lines and less than 5,000 tokens.

Skill descriptions should be optimized for reliable activation:

- Write descriptions as instructions to the assistant, such as `Use this skill when...`.
- Describe user intent and task scope, not internal implementation details.
- Include near-boundaries and non-obvious cases where the skill should or should not activate.
- Keep descriptions concise and under 1,024 characters.
- Evaluate descriptions with realistic should-trigger and should-not-trigger prompts.
- Use train and validation prompt sets to avoid overfitting descriptions to a small sample.

Scripts bundled with skills should be safe and agent-friendly:

- Keep scripts self-contained or document dependencies clearly.
- Produce structured output such as JSON, CSV, or TSV when practical.
- Send machine-readable output to stdout and diagnostics to stderr.
- Return helpful error messages that explain what failed, what was expected, and what to try next.
- Support idempotent execution and `--dry-run` for destructive or stateful operations.
- Keep output sizes predictable and support pagination, offsets, or summary modes for large outputs.

Skills should include evaluation assets when practical:

- Store realistic eval cases in `evals/evals.json`.
- Include prompts, expected outcomes, and optional input files.
- Run evals with the skill and without the skill, or against the previous skill version.
- Use clean workspaces and fresh context for eval runs.
- Capture output files, assertions, timing, and token usage where available.

The `SkillRegistry` should support:

- Listing built-in and installed skills.
- Installing or registering skills.
- Validating skill metadata.
- Enabling skills per agent.
- Resolving only the skill context needed for the current run.
- Returning structured activation content for a selected skill.
- Deduplicating repeated activations within a run.
- Protecting active skill instructions from context compaction.
- Tracking which skills were used during a run.

Skills should not bypass the tool permission model. If a skill needs filesystem, MCP, browser, GitHub, Figma, or network access, the agent must also have permission to use the matching tools.

## 8. Custom MCP

The runtime should support custom MCP servers as optional extensions. MCP configuration should be managed through the CLI and stored in local configuration so the CLI, Node.js API, and HTTP server all load the same MCP registry.

The CLI should support adding an MCP configuration with:

```bash
oa mcp -a "example"
```

An MCP entry should include:

- MCP id.
- Display name.
- Transport type, such as `stdio` or `http`.
- Command and arguments for `stdio` servers.
- URL for HTTP servers.
- Allowed environment variables or secret references.
- Working directory, when needed.
- Enabled or disabled status.
- Tool and resource permissions exposed by the MCP server.

The MCP registry should support:

- Listing configured MCP servers.
- Adding or updating MCP server definitions.
- Enabling MCP tools per agent.
- Starting and stopping MCP connections.
- Listing MCP resources and tools through the normal permission model.
- Recording MCP tool calls and resource reads in the run audit log.

Custom MCP tools should never be available globally by default. An agent must explicitly allow the MCP server or specific MCP tools before a run can use them.

## 9. Model Providers

The system should support multiple configurable model providers.

Each provider configuration should include:

- Provider id.
- Provider type.
- API base URL.
- Authentication method.
- Available models.
- Default model.
- Rate limits.
- Timeout settings.
- Retry policy.
- Cost or usage metadata when available.

The runtime should allow agents to choose from configured providers according to policy. Provider selection can be static per agent at first, then later become dynamic based on task type, cost, latency, context length, or fallback rules.

## 10. HTTP API

The HTTP API should expose management and execution endpoints.

Initial endpoint groups:

- `GET /health`: service health.
- `GET /agents`: list registered agents.
- `POST /agents`: create or register an agent definition.
- `GET /agents/:id`: get agent details.
- `PATCH /agents/:id`: update an agent definition.
- `DELETE /agents/:id`: remove or disable an agent.
- `POST /agents/:id/runs`: start a run with a prompt and optional files.
- `GET /runs`: list runs.
- `GET /runs/:id`: get run status and metadata.
- `POST /runs/:id/cancel`: cancel a run.
- `GET /runs/:id/logs`: stream or page run logs.
- `GET /tools`: list available tool groups.
- `GET /skills`: list available skills.
- `GET /mcp`: list configured MCP servers.
- `GET /providers`: list configured model providers.

Run creation through `POST /agents/:id/runs` should accept:

- `prompt`: the user instruction for the run.
- `files`: optional uploaded files or file references to place in the run input workspace.
- `metadata`: optional structured caller metadata.

The HTTP API should support `application/json` requests for prompt-only runs and `multipart/form-data` requests for prompt plus file uploads. Uploaded files should be copied into the run's `input/` directory, recorded in run metadata, and made available to the assistant through workspace-scoped filesystem tools.

HTTP responses should use structured JSON envelopes with stable error codes.

## 11. Isolated Agent Workspaces

Every agent run should receive an isolated workspace.

Workspace layout recommendation:

```text
.openarmy/
  agents/
    <agent-id>/
      config.json
      memory/
      runs/
        <run-id>/
          input/
            prompt.txt
            files/
          output/
          workspace/
          logs/
          state.json
```

The workspace should support:

- Run-local files.
- Uploaded input files and the original prompt.
- Agent-level persistent memory.
- Structured state snapshots.
- Tool output artifacts.
- Logs and traces.

Agents can store data in their isolated workspace, but they should not have unrestricted access to other agents' workspaces.

## 12. Multi-Agent Orchestration

The runtime should support multiple agents running at the same time.

The system should track:

- Agent id.
- Run id.
- Parent run id, when spawned by another agent.
- Current status.
- Current step.
- Started at.
- Updated at.
- Completed at.
- Tool calls.
- Skill usage.
- Model provider usage.
- Workspace path.
- Error state.

Sub-agent support should allow a parent agent to:

- Spawn another agent.
- Send input to another agent.
- Wait for completion.
- Resume a paused agent.
- Close an agent.
- Read final status and outputs.

The orchestrator should enforce concurrency limits and prevent runaway agent spawning.

## 13. Scheduler

The system should include a cron scheduler for recurring agent runs.

Scheduler requirements:

- Register cron expressions per agent.
- Validate schedules before saving.
- Trigger runs at the correct time.
- Prevent duplicate overlapping runs unless allowed.
- Store schedule history.
- Record missed, failed, skipped, and successful executions.

Example schedule configuration:

```json
{
  "agentId": "daily-reporter",
  "cron": "0 8 * * *",
  "timezone": "UTC",
  "enabled": true,
  "allowOverlap": false
}
```

## 14. Heartbeat

The runtime should maintain heartbeat tracking for agents and long-running tasks.

Heartbeat requirements:

- Record heartbeat timestamp per active run.
- Mark runs as stale when the heartbeat timeout is exceeded.
- Expose heartbeat events through HTTP status and log endpoints.
- Expose heartbeat status through the HTTP API.
- Allow recovery logic for stalled runs.

Heartbeat state should be visible in run metadata and logs.

## 15. State, Logs, and Audit Trail

The system should persist enough data to debug and resume agent activity.

Minimum records:

- Agent definitions.
- Run metadata.
- Run status transitions.
- User inputs.
- Uploaded file metadata, including original filename, stored path, size, and content type.
- Model requests and responses metadata.
- Tool calls and results.
- Skill load events.
- MCP configuration events, tool calls, and resource reads.
- Filesystem mutations.
- Scheduler events.
- Heartbeat events.
- Errors and cancellation reasons.

Do not store raw secrets in logs.

## 16. Configuration

The runtime should support configuration from files and environment variables.

Initial configuration areas:

- Model providers.
- Default agent policies.
- Workspace root.
- HTTP server host and port.
- HTTP request body, prompt, and upload size limits.
- Scheduler enabled/disabled.
- Heartbeat intervals.
- Tool permissions.
- Skill directories.
- MCP server definitions.
- Log level.

Configuration should be validated at startup and surfaced through clear errors.

## 17. Security Requirements

Security should be part of the first design, not an afterthought.

Required controls:

- Workspace isolation.
- Tool permission checks.
- Network access policy.
- MCP server and MCP tool permission checks.
- Secret redaction in logs.
- API authentication.
- HTTP API authorization.
- Upload filename sanitization, content type validation, and file size limits.
- Rate limits for HTTP API traffic.
- Per-agent concurrency limits.
- Audit logs for mutating operations.

Any tool that can mutate files, run commands, access the network, or call external services should require explicit permission.

## 18. Testing Requirements

Every implementation change should include automated tests unless the change is documentation-only or explicitly marked as untestable with a short reason.

The project should use the existing test commands:

```bash
npm test
npm run typecheck
npm run test:smoke
```

Use Vitest for unit and integration tests. Use smoke tests for CLI startup, local runtime startup, and HTTP server startup.

Required test coverage areas:

- `RuntimeCore` composition shared by CLI, Node.js API, and HTTP server.
- Agent registration, run creation, status transitions, cancellation, and concurrency limits.
- Workspace creation, run isolation, path traversal rejection, symlink escape rejection, and read/write size limits.
- Tool search selection, rejected candidate filtering, least-privilege selection, and execution through `ToolRegistry`.
- Filesystem tools for successful reads, writes, appends, patches, listings, moves, deletes, metadata, and search.
- File parsing for text, JSON, CSV, PDF, unsupported file types, parser failures, input size limits, and normalized output.
- Web scraping for allowed URLs, blocked protocols, blocked domains, redirect limits, response size limits, timeout handling, and structured extraction output.
- Tool permission failures and audit logs for mutating operations.
- Skill registry behavior for built-in skills and installed skills through `oa skills -a "name of skill"`.
- Skill discovery, filtered catalogs, activation, resource listing, activation deduplication, context protection, and eval case loading.
- MCP registry behavior for custom MCP configuration through `oa mcp -a "example"`.
- MCP permission enforcement so custom MCP tools are unavailable unless explicitly allowed for the agent.
- HTTP API JSON envelopes, stable error codes, authentication, authorization, and rate limits.
- HTTP run creation with prompt-only JSON, multipart prompt plus files, upload size limits, filename sanitization, and run input workspace persistence.
- Scheduler execution, skipped overlapping runs, missed runs, and schedule history.
- Heartbeat updates, stale-run detection, and heartbeat events in run metadata.
- Secret redaction in logs, audit records, tool results, and error responses.

Tests should use temporary workspaces and must clean up after themselves. Tests should not depend on external network access unless they are explicitly integration tests that can be skipped in local development.

## 19. Implementation Phases

### Phase 1: Local Runtime Foundation

- Add agent definitions.
- Add run tracker.
- Add isolated workspace manager.
- Add filesystem tools.
- Add basic model provider abstraction.
- Add local CLI commands for agent runs.
- Add tests for runtime creation, workspace isolation, filesystem tools, and CLI run startup.

### Phase 2: Skills, Tool Registry, and MCP

- Add skill registry.
- Add tool registry.
- Add MCP registry and `oa mcp -a "example"` configuration command.
- Enforce per-agent tool permissions.
- Track skill and tool usage in run metadata.
- Add tests for skill installation, MCP registration, tool permissions, and audit logs.

### Phase 3: HTTP API

- Add HTTP API.
- Stream run events and logs.
- Add structured API errors.
- Add tests for health, agents, runs, tools, skills, MCP, providers, logs, auth, and rate limits.

### Phase 4: Scheduling and Heartbeat

- Add cron scheduler.
- Add heartbeat monitor.
- Add stale-run detection.
- Add recovery or cancellation policy.
- Add tests for scheduler history, overlap prevention, heartbeat updates, and stale-run detection.

### Phase 5: Multi-Agent Orchestration

- Add sub-agent spawning.
- Track parent/child run relationships.
- Add concurrency limits.
- Add orchestration logs and status views.
- Add tests for parent/child run tracking, spawn limits, waiting, resume, close, and cancellation.

### Phase 6: Provider Expansion

- Add multiple model providers.
- Add provider fallback.
- Add provider usage tracking.
- Add configurable model policies.
- Add tests for provider selection, fallback, retry policy, usage metadata, and timeout handling.

## 20. Open Questions

These questions should be resolved as the design improves:

- Should agent definitions live in npm plugin metadata, local config files, or a dedicated registry?
- Should workspaces be stored under the existing OpenArmy home directory or inside each project?
- Which model providers should be supported first?
- Should the HTTP server be built into the CLI process or run as a separate server?
- What authentication model should local development use?
- How much run history should be retained by default?
- Should scheduler state be file-based first or database-backed from the start?
