# Sofapotatoed Agent architecture v0.2

## Non-negotiable account ownership

**One bound account → exactly one supervisor.** Account registration owns the supervisor lifecycle; there is no separate "Create Supervisor" operation. Register 3 Codex + 2 Claude homes → 5 supervisors. Each supervisor may create multiple assistants or review agents, which use the **same account as their supervisor**, not a different model credential. An assistant cannot create nested assistants.

```text
AccountBinding (id, provider, label, fingerprint, accountHome OR credentialEnv, leadId)
                     1:1 ↓
Supervisor (id, accountId, SOUL.md, Skills[], MCP[])
                     1:N ↓
Assistant (id, parentId, accountId inherited, SOUL.md, Skills[], MCP[])
```

The server stores account binding fields in `accounts[]` and agents in `agents[]`, linked by `accountId`. `GET /api/state` returns a scrubbed projection: no account paths, env variable names, fingerprints or token values. On execution the server obtains the binding using the agent's verified parent chain; the assistant's submitted provider fields are rejected.

### Account binding API

- `POST /api/accounts`: validate provider-specific reference, reject duplicate fingerprints, atomically persist account binding + supervisor and emit event.
- `POST /api/agents`: requires `parentId` of an existing supervisor; can create an assistant only; no provider or account overrides.
- `GET /api/state`: public account summary + supervisor/assistant data.
- `PUT /api/agents/:id/soul`: independent editable SOUL text.
- `PUT /api/agents/:id/skills` and `/mcp`: reference arrays, not execution.
- `POST /api/tasks`: execute using the supervisor account binding.
- `POST /api/messages`: explicit supervisor ↔ supervisor, supervisor ↔ own assistants.

### Binding identity vs verified login

Current fingerprints prevent registering the same CLI **home path** (or the same API secret-env / endpoint pair) twice; they do not establish external Codex/Claude provider account identity. The API deliberately returns `verified:false` and `status:registered`. A future **login broker** must verify provider identity and enforce account uniqueness at that level before showing `verified:true`. OAuth tokens must never be included in HTTP responses, logs or `SOUL.md`.

Legacy v0.1 leads are migrated to account bindings with private paths retained; assistants keep their own SOUL text. Legacy duplicate connections are retained and flagged for identity review, not silently deleted.

## Communication and orchestration

Supervisor-to-supervisor communication is allowed through an explicit internal message, but **communication does not delegate account access**. Assistants can send messages only to their own supervisor. Future typed protocols will add validated sender identity and delegated tasks with explicit acceptance. Task operations should become durable with per-supervisor concurrency / budget limits and human approvals for tool writes.

## MCP, Skills and SOUL

Each agent owns one independent `SOUL.md` profile and a list of granted MCP/Skill references. MVP stores references but does **not** yet execute MCP servers or Skills. The next executor needs tool manifests, explicit per-account grants, process isolation, owner-scoped filesystems, revocation and an auditable approval flow.

## Security gates

The current server is **local-only**, unauthenticated, and not a secure multi-tenant app. Do not expose outside `127.0.0.1`. Before remote/multi-user deployment add real user auth/RBAC, OS keychain vault, verified account identity, audited tool permissions, sandboxing, durable jobs, protocol versioning, and traffic encryption.