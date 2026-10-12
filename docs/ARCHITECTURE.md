# Architecture v0.1

## Accounts, ownership and isolation

Lead agents own their provider binding (Codex or Claude CLI isolated account-home directory; OpenAI-compatible provider secret environment variable name). Child agents retain `parentId` and an independent `SOUL.md` while provider credentials resolve exclusively through their lead. A child cannot create further assistants in the first release. Cross-lead messages never carry credentials.

## Agent execution

The first implementation includes demo provider, OpenAI-compatible Chat Completions, and opt-in local Codex/Claude CLI launchers. Codex is read-only; Claude is launched in plan mode. UI events are based on actual task lifecycle, not fabricated activity. Long-running tasks should be moved to a durable queue with concurrency and budget control.

## API design

`GET /api/state` — agents, messages, tasks and events with secrets excluded.
`POST /api/agents` — create lead or assistant, inheriting parent provider binding.
`PUT /api/agents/:id/soul` — edit independent persona.
`PUT /api/agents/:id/skills` — registry references.
`PUT /api/agents/:id/mcp` — registry references.
`POST /api/tasks` — dispatch work to a named agent.
`POST /api/messages` — explicit communication between leads, or within a lead's team.
`GET /api/events` — SSE event feed.

## Hardening required before exposure

Add authentication/RBAC, OS credential store, per-agent tool authorization, path restrictions, tamper-resistant logs and HTTPS/TLS. The initial local server binds to 127.0.0.1 and must not be exposed to the LAN.

## MCP and Skills

Registry references are not tool execution. Implement MCP stdio/Streamable HTTP connection management, explicit transport config, per-lead grants, per-tool write approvals, revocation and auditing. Implement Skills as versioned, sandboxed, scoped instructions and explicit code capabilities. Never silently execute arbitrary skill shell commands.

## Supervisor protocol

Leads may spawn bounded reviewer assistants only against the lead-owned credential. Reviewers receive task-specific prompts, independently return evidence, and their lead consolidates results. Inter-lead delegation uses typed messages with sender/receiver verification and requires permissions, never silent account sharing.
