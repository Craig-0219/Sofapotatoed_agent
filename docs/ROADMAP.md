# Roadmap

- [x] One new registered Codex/Claude account binding creates exactly one supervisor.
- [x] Assistants inherit the supervisor's account (cannot override credentials).
- [x] Duplicate CLI account-home paths / API secret references rejected.
- [x] Pixel office, SOUL profiles, tasks, and explicit supervisor messaging.
- [x] Legacy v0.1 local data migration.
- [ ] Verify the real Codex/Claude account identity across homes; sign in through device/browser flows.
- [ ] Authenticated user management, per-account secure credential vault, RBAC.
- [ ] Live MCP client, scoped tools, approval and execution audits.
- [ ] Versioned Skill loader with sandbox, provenance and access policies.
- [ ] Durable concurrent workers, per-supervisor queues and cost/usage limits.
- [ ] Automated review subagents using their own supervisor's account only.
- [ ] Task-delegation messaging protocol between supervisors.
- [ ] Pixel office movement based on real workload state and browser E2E tests.
- [ ] Windows installer and signed releases.

Do not present registered account settings as a successful OAuth login. Never publish tokens or local `state.json`.