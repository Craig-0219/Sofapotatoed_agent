# Sofapotatoed Agent — Pixel Office v0.2.0

Local-first pixel-office prototype for multi-agent work. **One bound provider account = one supervisor agent.** Supervisors can create assistants and reviewers using only their own account. Supervisors can communicate without sharing credentials.

## The ownership rule

```text
Office
├── Codex account A → Supervisor A → Assistants A1, A2, Reviewer A3
├── Codex account B → Supervisor B → Assistants B1, B2
├── Codex account C → Supervisor C
├── Claude account A → Supervisor D → Assistant D1
└── Claude account B → Supervisor E → Reviewer E1
```

Registering **3 Codex and 2 Claude account homes creates exactly 5 supervisors**, not 2 provider-level supervisors. New accounts are always registered with `POST /api/accounts`, which atomically creates one account binding and one supervisor. `POST /api/agents` creates **assistants only** and requires an existing supervisor ID. A duplicate CLI account home or API credential reference cannot create another supervisor.

Each supervisor has its own `SOUL.md` text; each assistant also has its own persona, Skills references and MCP references but resolves model credentials through the supervisor's account binding. Assistant requests attempting to override a provider, account ID, home directory or API credential are rejected server-side.

## Quick start

```bash
npm start
# Open http://127.0.0.1:3210
npm test
```

Requires Node.js 20+; no npm install necessary. By default all state stays in `~/.sofapotatoed-agent/state.json` with owner-only file permissions. Back up this file before upgrading. v0.1 local state is migrated to the new account model without deleting agents; migrated bindings should be reviewed.

## Register account → create supervisor

Open **＋ 綁定新帳號 / 建立主管** in the pixel-office UI and select the account provider. The app records a local **account binding**, then creates its supervisor immediately. No token is submitted to or stored in the browser. For CLI accounts, provide an **absolute, account-specific home directory**:

- **Codex CLI**: `provider=codex`; sign in independently to each `CODEX_HOME` (e.g., `CODEX_HOME=/path/codex-a codex login --device-auth`). On Windows set `$env:CODEX_HOME = 'C:\\path\\codex-a'` in a PowerShell session, create that directory, and then run `codex login --device-auth`. Use a different directory for each account.
- **Claude CLI**: `provider=claude`; sign in to each isolated `CLAUDE_CONFIG_DIR` using the Claude CLI's supported sign-in flow. Use a separate directory per account.
- **OpenAI-compatible API**: `provider=openai-compatible`; set the server-side API-key **environment variable name** (not the key value), model and HTTPS Chat Completions endpoint.
- **Demo**: creates a local simulated account/supervisor, suitable for UI and task tests without an external service.

Set `ENABLE_CLI_AGENTS=1` **only after** configuring CLI accounts. Codex tasks run in read-only mode, Claude tasks in plan mode. The CLI adapter is an early prototype, not a full sandbox. On Windows, check that the CLI executables are callable from the server process.

**Important v0.2 limitation:** registering a binding does *not* perform OAuth, prove a logged-in identity, or authenticate a user. Duplicate protection is based on the **provider + account-home path** (or provider + API endpoint + env-name), not verified provider account IDs. Different directories containing the same logged-in account cannot yet be detected. Add a verified identity check and an isolated login flow in a later release.

## Security and limitations

- The app listens on **127.0.0.1** by default, without user authentication. **Never expose this prototype to LAN/Internet.**
- Accounts are stored in private server state; API responses omit account-home paths, API-key env names and fingerprint keys; tokens remain only in their external CLI homes/server environment.
- Supervisors can explicitly message each other; assistants cannot message other teams directly.
- MCP and Skills are **registries only**, not executable tools. Bounded subagent auto-spawning, approvals, durable queue, verified account login and multi-user RBAC are next milestones.
- This is original project scaffold, not a modified/repackaged official Codex Vitals application. If upstream source is added, retain its MIT and third-party notices. Do not imply endorsement by OpenAI or Anthropic.

See [Architecture](docs/ARCHITECTURE.md).