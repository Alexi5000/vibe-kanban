<p align="center">
  <picture>
    <source srcset="packages/public/vibe-kanban-logo-dark.svg" media="(prefers-color-scheme: dark)">
    <source srcset="packages/public/vibe-kanban-logo.svg" media="(prefers-color-scheme: light)">
    <img src="packages/public/vibe-kanban-logo.svg" alt="Vibe Kanban Logo">
  </picture>
</p>

<p align="center"><strong>Agent task orchestration board</strong> — real-time visibility into what AI agents are doing across your repos.</p>

![](packages/public/vibe-kanban-screenshot-overview.png)

## The problem

Agent orchestration without visibility is chaos. When five coding agents are
working three repos — each spawning sub-agents, managing task queues, opening
PRs — the operator needs a board that shows what agents are *actually doing*,
not what they were asked to do three minutes ago. Stale dashboards and
terminal scrollback don't survive contact with a 12-agent deployment.

Vibe Kanban closes that gap: a kanban board where agents report their own
task state over MCP. What's queued, what's in-flight, what's blocked, what
shipped — live, per agent, per repo.

- **Plan with kanban issues** — create, prioritise, and assign work on a board
- **Run coding agents in workspaces** — each workspace gives an agent a branch, a terminal, and a dev server
- **Review diffs with inline comments** — send feedback straight back to the agent
- **Preview your app** — built-in browser with devtools and device emulation
- **Switch between 10+ coding agents** — Claude Code, Codex, Gemini CLI, Copilot, Amp, Cursor, OpenCode, Droid, CCR, Qwen Code
- **Open and merge PRs** — with AI-generated descriptions

We run this fork in production at [TechTide AI](https://github.com/TechTideOhio)
to keep human operators in the loop on multi-agent client deployments —
delivery monitoring, incident response when an agent wedges, and sprint
retrospectives over agent throughput. See [TECHTIDE.md](TECHTIDE.md).

## Fork status

This is a maintained fork of
[BloopAI/vibe-kanban](https://github.com/BloopAI/vibe-kanban) (Apache-2.0).
**Upstream is sunsetting** ([announcement](https://www.vibekanban.com/blog/shutdown)),
so this fork stands on its own from `v0.1.44`. We contributed fixes upstream
while it was active:

| PR | Description |
|----|-------------|
| [#3418](https://github.com/BloopAI/vibe-kanban/pull/3418) | Exclude ambiguous characters from SPAKE2 enrollment codes |
| [#3419](https://github.com/BloopAI/vibe-kanban/pull/3419) | Add start/target date fields to the MCP update-issue tool |
| [#3420](https://github.com/BloopAI/vibe-kanban/pull/3420) | Fix MCP backend URL discovery with a health-check probe |

## Getting started

Run from source (Rust stable, Node >= 20, pnpm >= 8):

```bash
pnpm i
pnpm run dev
```

Or run the containerized local stack:

```bash
docker compose up --build
```

`npx vibe-kanban` installs upstream's final published npm release, not this
fork.

## Proof, honestly scoped

Two independent proof surfaces back this repo — see
[docs/FDE_GATES.md](docs/FDE_GATES.md) for the full twelve-pillar gate table:

- **Product core (Rust, 33 crates).** Upstream's test suite — 263 Rust test
  functions — runs in [.github/workflows/test.yml](.github/workflows/test.yml)
  on every change, exactly as it did before the fork.
- **Orchestration contract (FDE layer).** `packages/fde` is a deterministic
  offline harness: a Planner → Generator → Evaluator pipeline over typed,
  versioned sprint contracts grounded in the real task state machine
  (`crates/db/src/models/task.rs`), graded on four axes with adversarial
  negative controls. No LLM keys, no network, byte-identical output every
  run. Results and limitations: [docs/BENCHMARK.md](docs/BENCHMARK.md).

```bash
pnpm run fde:test        # 51 tests over the harness
pnpm run fde:evals       # 12/12 orchestration scenarios
pnpm run contracts:check # contract artifact drift gate
```

What we do **not** claim: the FDE gates do not certify the Tauri desktop
app, relay/WebRTC tunneling, or the remote deployment stack
([ADR 0005](docs/adr/0005-scope-fde-to-orchestration-core.md)).

## Development

Working agreements for humans and agents live in [AGENTS.md](AGENTS.md).
Architecture decisions are recorded in [docs/adr/](docs/adr/).

| Command | Purpose |
|---|---|
| `pnpm run dev` | Backend + web app with auto-assigned ports |
| `pnpm run check` | Type checks across frontend and Rust workspaces |
| `cargo test --workspace` | Rust test suite |
| `pnpm run generate-types` | Regenerate TS types from Rust (never edit `shared/types.ts` by hand) |
| `pnpm run fde:test` / `fde:evals` | FDE harness tests and offline evals |

<details>
<summary>Environment variables</summary>

| Variable | Type | Default | Description |
|----------|------|---------|-------------|
| `POSTHOG_API_KEY` | Build-time | Empty | PostHog analytics API key (disables analytics if empty) |
| `POSTHOG_API_ENDPOINT` | Build-time | Empty | PostHog analytics endpoint (disables analytics if empty) |
| `PORT` | Runtime | Auto-assign | **Production**: Server port. **Dev**: Frontend port (backend uses PORT+1) |
| `BACKEND_PORT` | Runtime | `0` (auto-assign) | Backend server port (dev mode only, overrides PORT+1) |
| `FRONTEND_PORT` | Runtime | `3000` | Frontend dev server port (dev mode only, overrides PORT) |
| `HOST` | Runtime | `127.0.0.1` | Backend server host |
| `MCP_HOST` | Runtime | Value of `HOST` | MCP server connection host (use `127.0.0.1` when `HOST=0.0.0.0` on Windows) |
| `MCP_PORT` | Runtime | Value of `BACKEND_PORT` | MCP server connection port |
| `DISABLE_WORKTREE_CLEANUP` | Runtime | Not set | Disable git worktree cleanup (for debugging) |
| `VK_ALLOWED_ORIGINS` | Runtime | Not set | Comma-separated origins allowed to call the backend API |
| `VK_SHARED_API_BASE` | Runtime | Not set | Base URL for the remote/cloud API used by the desktop app |
| `VK_SHARED_RELAY_API_BASE` | Runtime | Not set | Base URL for the relay API used by tunnel-mode connections |
| `VK_TUNNEL` | Runtime | Not set | Enable relay tunnel mode (requires relay API base URL) |

Behind a reverse proxy or custom domain, set `VK_ALLOWED_ORIGINS` to the full
origin URL(s) of your frontend, or API requests fail with 403.

</details>

## License

Apache-2.0, same as upstream. Original work © BloopAI and the vibe-kanban
contributors; fork maintenance © TechTide AI.
