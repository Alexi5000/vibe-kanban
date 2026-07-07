# TechTide AI — Why This Fork Exists

## The Problem

Agent orchestration without visibility is chaos. When you're running five Claude Code agents across three repos, each spawning sub-agents and managing their own task queues, you need a board that shows what agents are *actually doing* — not what you asked them to do three minutes ago.

## Why Vibe Kanban

Vibe Kanban solves the operator visibility gap. It gives teams a real-time board for agent task state: what's queued, what's in-flight, what's blocked, what shipped. The MCP integration means agents report status directly — no polling, no guessing, no stale dashboards.

We use this internally at TechTide to manage multi-agent deployments for clients running production Claude Code workflows. When a client's orchestration pipeline has 12 agents touching 4 repos, Vibe Kanban is how the human operator stays in the loop.

## What TechTide Uses This For

- **Client delivery monitoring** — Real-time visibility into agent task completion across client engagements
- **Multi-agent coordination** — Tracking parallel agent workflows that would otherwise be invisible
- **Incident response** — When an agent gets stuck in a loop or hits an error, the board surfaces it immediately
- **Sprint retrospectives** — Historical view of agent throughput and bottleneck patterns

## Upstream Contributions

We contribute fixes and improvements back to the upstream project:

| PR | Description |
|----|-------------|
| [#3418](https://github.com/BloopAI/vibe-kanban/pull/3418) | Exclude ambiguous characters from enrollment codes (SPAKE2) |
| [#3419](https://github.com/BloopAI/vibe-kanban/pull/3419) | Add start/target date fields to MCP update-issue tool |
| [#3420](https://github.com/BloopAI/vibe-kanban/pull/3420) | Fix MCP backend URL discovery with health-check probe |

## Architecture Notes

Vibe Kanban is a Rust monorepo (34 crates) with a TypeScript frontend and Tauri desktop app. The MCP server (`crates/mcp/`) exposes task management tools that AI agents call directly. The SPAKE2 enrollment flow (`crates/trusted-key-auth/`) handles secure browser-to-server pairing without transmitting passwords.

Key strengths:
- **Type safety**: Strong Rust types with `schemars` for MCP tool schemas
- **Error handling**: Comprehensive `thiserror` error types throughout
- **Security**: SPAKE2 PAKE protocol for zero-knowledge device enrollment

---

*This fork is maintained by [TechTide AI](https://github.com/TechTideOhio) as part of our agent infrastructure stack.*
