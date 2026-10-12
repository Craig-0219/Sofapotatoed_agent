# Sofapotatoed Agent — Pixel Office

A local-first multi-agent office project with a pixel-art dashboard, lead agents, child assistants and private account boundaries.

## Vision
- Multiple backends: Codex CLI, Claude CLI, OpenAI-compatible LLM endpoints.
- One independently editable `SOUL.md`-style identity per agent.
- Each lead agent can create assistants **only under the lead's own account context**.
- Parallel review agents, controlled delegation, evidence-based task review.
- Inter-lead communications via explicit internal messages.
- MCP server registry and Skill registry with per-agent grants.
- Pixel-game-inspired office UI showing desks, agent roles, live tasks and activity.

## Security decisions
- Agent ownership and credential access must be verified **on the server**, not by prompts.
- No token material in GitHub, browser local storage, UI data or messages.
- Cross-lead communication does **not** grant cross-lead credential access.
- MCP writes and file/system actions require scoped permissions and approval.
- Default deployment is local-only; do not expose the prototype to the internet.
- No autonomous provider account cycling.

## Build order
1. Lead/assistant model, office UI, SOUL profiles, persistent task/messages APIs.
2. Provider adapters with safe account homes and OpenAI-compatible endpoint.
3. Durable queue, per-lead concurrent workers, review orchestration and budgets.
4. Actual MCP and Skill execution with isolation, approvals and allowlists.
5. Authentication, secrets vault, multi-user RBAC, and packaging.

See [Architecture](docs/ARCHITECTURE.md) and [Roadmap](docs/ROADMAP.md).

> Project is an original scaffold inspired by Codex Vitals workflow. If upstream source is copied later, preserve MIT notices and third-party license files.
