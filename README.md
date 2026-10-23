<p align="center">
  <picture>
    <source srcset="packages/public/vibe-kanban-logo-dark.svg" media="(prefers-color-scheme: dark)">
    <source srcset="packages/public/vibe-kanban-logo.svg" media="(prefers-color-scheme: light)">
    <img src="packages/public/vibe-kanban-logo.svg" alt="Vibe Kanban Logo">
  </picture>
</p>

<p align="center"><strong>Agent task orchestration board</strong>: real-time visibility into what AI agents are doing across your repos.</p>

![](packages/public/vibe-kanban-screenshot-overview.png)

## Why this fork exists

**What it does.** Vibe Kanban is a kanban board and workspace manager for coding agents. Each
issue can be handed to an agent (Claude Code, Codex, Gemini CLI, Copilot, Amp, Cursor, OpenCode,
Droid, CCR, Qwen Code) in an isolated git worktree with its own terminal and dev server, and
agents report task state back over MCP (`crates/mcp/`). Operators review diffs with inline
comments, preview the running app, and open or merge PRs from the board.

**Who it serves.** A human operator supervising several coding agents across one or more
repositories who needs a single live view of what is queued, in flight, blocked, or shipped,
instead of reconstructing that state from terminal scrollback.

**Why Alex forked it.** The fork was created on 2025-11-03 (GitHub API `created_at`). The
first fork-only commits landed on 2026-05-21 and record the motivation directly:
`508e86dfb` "fix: exclude ambiguous characters from relay pairing codes", `3a66c4657`
"feat: add start_date and target_date to update_issue MCP tool", `b1f1f5818` "fix: validate MCP
backend URL with health-check probe before use", and `1caee6001` "docs: add TechTide backstory
document", which created [TECHTIDE.md](TECHTIDE.md). That document states the reason in Alex's
words: "Agent orchestration without visibility is chaos. When you're running five Claude Code
agents across three repos, each spawning sub-agents and managing their own task queues, you need
a board that shows what agents are actually doing." The same three fixes were offered upstream as
BloopAI PRs [#3418](https://github.com/BloopAI/vibe-kanban/pull/3418),
[#3419](https://github.com/BloopAI/vibe-kanban/pull/3419), and
[#3420](https://github.com/BloopAI/vibe-kanban/pull/3420). On 2026-07-06 the fork added an
offline orchestration-contract harness (`packages/fde`, merge `fd2e96e0f`, PR #1), and after the
upstream company shut down on 2026-04-10[^1] the fork took over its own dependency and security
maintenance (32 merged PRs, #2 through #36, 2026-10-18 to 2026-10-20; see Upstream below).

**Real-world use case (2025-2026 evidence).** **Proposed use case.** A solo maintainer or small
team runs three to five coding agents in parallel on a monorepo, one worktree each, and uses
the board as the human checkpoint before anything merges. The agents push status through MCP
tool calls using the 2025-06-18 protocol revision, which added structured tool output and
tightened authorization requirements for exactly this kind of agent-to-server reporting[^2]. The
checkpoint matters: in the 2025 Stack Overflow Developer Survey, 84% of respondents use or plan
to use AI tools, yet 46% distrust the accuracy of AI output and 76% do not plan to hand
deployment and monitoring to AI[^3]. Anthropic's 2025 engineering write-up on multi-agent
systems reached a similar conclusion, noting that coding tasks have fewer truly parallelizable
pieces than research and that agents "are not yet great at coordinating and delegating to other
agents in real time", which is the gap a shared board fills[^4]. What this repository verifies
today is narrower than the scenario: the Rust test suite and the offline FDE harness run in CI
on every change (see Proof, honestly scoped). No customer deployment, throughput result, or
incident outcome is claimed.

[^1]: Louis Knight-Webb, "Goodbye bloop", vibekanban.com, published 2026-04-10. https://www.vibekanban.com/blog/shutdown
[^2]: Model Context Protocol, "Key Changes", specification revision 2025-06-18. https://modelcontextprotocol.io/specification/2025-06-18/changelog
[^3]: Stack Overflow, "2025 Developer Survey: AI", published 2025. https://survey.stackoverflow.co/2025/ai
[^4]: Anthropic Engineering, "How we built our multi-agent research system", published 2025-06-13. https://www.anthropic.com/engineering/multi-agent-research-system

## Upstream

- Upstream: [BloopAI/vibe-kanban](https://github.com/BloopAI/vibe-kanban), licensed Apache-2.0.
  This fork keeps the same license; the `LICENSE` file is unchanged and the fork is not relicensed.
- Fork created: 2025-11-03. Upstream's company announced its shutdown on 2026-04-10 and said the
  project would continue as community-maintained open source[^1]; this fork stands on its own
  from `v0.1.44`.
- Divergence as of 2026-10-20: 46 commits ahead and 10 commits behind upstream `main`
  (`gh api repos/Alexi5000/vibe-kanban/compare/BloopAI:main...Alexi5000:main`); 393 files
  changed, +82,003 / -6,359 lines against the merge base (`git diff --stat upstream/main...origin/main`;
  the API response caps its file list at 300).
- `npx vibe-kanban` installs upstream's final published npm release, not this fork.

**What changed in this fork** (from `git log upstream/main..origin/main`):

- 2026-05-21: relay pairing-code fix, MCP `update_issue` date fields, MCP backend URL
  health-check (4 commits, also submitted upstream as PRs #3418 to #3420; #3438 still open).
- 2026-07-06 to 07-07: FDE orchestration contracts and offline harness (`packages/fde`,
  `contracts/`, `notebooks/`, `docs/adr/`), root `docker-compose.yml`, CI guards so upstream-only
  deploy and release jobs do not run in this repository (8 commits plus 2 merge commits).
- 2026-10-18 to 10-20: 32 merged security and dependency PRs (#2 to #36; #6, #7, and #14 were
  closed unmerged and superseded by #8 and #15): refreshed Rust and npm
  dependencies, vendored patched `tauri-plugin-updater`, `rama-dns`, and `codex-git-utils` under
  `vendor/`, Git operand and path validation, relay SSRF and secure-transport fixes, loopback-only
  OpenCode transport, read-only CI token, TLS verifier and trust-store refresh, and a private
  vulnerability reporting policy (`SECURITY.md`).

Upstream contributions made while upstream was active:

| PR | Description |
|----|-------------|
| [#3418](https://github.com/BloopAI/vibe-kanban/pull/3418) | Exclude ambiguous characters from SPAKE2 enrollment codes |
| [#3419](https://github.com/BloopAI/vibe-kanban/pull/3419) | Add start/target date fields to the MCP update-issue tool |
| [#3420](https://github.com/BloopAI/vibe-kanban/pull/3420) | Fix MCP backend URL discovery with a health-check probe |

## Features

- **Plan with kanban issues**: create, prioritise, and assign work on a board
- **Run coding agents in workspaces**: each workspace gives an agent a branch, a terminal, and a dev server
- **Review diffs with inline comments**: send feedback straight back to the agent
- **Preview your app**: built-in browser with devtools and device emulation
- **Switch between 10+ coding agents**: Claude Code, Codex, Gemini CLI, Copilot, Amp, Cursor, OpenCode, Droid, CCR, Qwen Code
- **Open and merge PRs**: with AI-generated descriptions

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

Two independent proof surfaces back this repo; see
[docs/FDE_GATES.md](docs/FDE_GATES.md) for the full twelve-pillar gate table:

- **Product core (Rust, 33 crates).** Upstream's Rust test suite (316 `#[test]` and
  `#[tokio::test]` functions under `crates/` as of 2026-10-20) runs in
  [.github/workflows/test.yml](.github/workflows/test.yml) on every change, exactly as it
  did before the fork.
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
origin URL(s) of your frontend, or API requests fail with 403. API Host headers
must identify localhost/a loopback address, the explicitly configured HOST
interface, or a host and port from VK_ALLOWED_ORIGINS. Binding HOST=0.0.0.0
accepts that literal authority but does not trust arbitrary DNS names or LAN
addresses; list those origins explicitly. Requests without Origin still need a
trusted Host. Relay forwarding rewrites Host to the actual local socket address
before the existing signed-request authorization runs. This rejects unconfigured
same-origin DNS hostnames at the API boundary; it is not a claim that an actual
browser DNS-rebinding attack was demonstrated.

</details>

## Security

Report suspected vulnerabilities through this fork's private reporting channel.
See [SECURITY.md](SECURITY.md) for the report link and details to include.

Dependency status as of 2026-10-20:

- GitHub Dependabot reports 0 open dependency alerts for this repository.
- `cargo audit` was not re-run in the 2026-10-20 documentation pass (no Rust toolchain in that
  environment). The most recent recorded run, in PR #35 (2026-10-20), reported two residual
  findings, neither dismissed:
  - [RUSTSEC-2023-0071](https://rustsec.org/advisories/RUSTSEC-2023-0071.html) (Marvin timing
    side channel in the `rsa` crate). Known upstream advisory with no fixed release as of
    2026-10-20; the advisory itself states rsa 0.9.10 is still affected (last modified
    2026-09-14). Mitigation in this fork: PR #30 (`bb214664b`) disabled the unused RSA feature of
    `russh` in the embedded SSH server (it only accepts Ed25519 keys), so the active
    all-target dependency tree contains no `rsa`; `rsa 0.9.10` remains in `Cargo.lock` only as
    optional `sqlx-mysql` metadata, which a raw audit still counts.
  - [RUSTSEC-2026-0381](https://rustsec.org/advisories/RUSTSEC-2026-0381.html) (distrusted
    emSign roots in `webpki-roots`, patched in 1.0.10). PR #35 upgraded `webpki-roots` and
    `webpki-root-certs` to 1.0.10. `Cargo.lock` still lists `webpki-roots 0.26.11`, a
    compatibility wrapper pulled in by `sqlx-core` and `tokio-tungstenite` whose only dependency
    is `webpki-roots 1.0.10`, so the bundled roots are the patched set; audit tools flag it by
    version metadata.

## License

Apache-2.0, same as upstream. Original work © BloopAI and the vibe-kanban
contributors; fork maintenance © TechTide AI.

### WebRTC session authority

WebRTC is an optimization of an authenticated relay browser session. The relay
and local host must both support the session-authority protocol. The relay
replaces host/session metadata before forwarding a cryptographically signed
SDP offer; an unclassified local offer or an old relay without this metadata
cannot create a peer. Existing clients retain their relay transport fallback.
No browser payload changes or additional credentials are required.

The local host checks the configured relay's dedicated authorization endpoint
with its existing refreshed host access token. The endpoint validates host
ownership and machine identity, then checks the browser session, backing login
session, user and current host access. Peer IDs and ICE candidates are scoped
to that immutable host/browser-session binding. Signing-session TTL is not a
substitute for this authority check.

Each incoming peer operation revalidates authority. A background monitor also
checks active peers every second; each check, including token refresh, has a
two-second total timeout. Revocation or authority failure cancels the peer and
its in-flight HTTP/WebSocket work, with a maximum detection window of three
seconds plus scheduling latency. Already-completed side effects cannot be
undone. A cancelled peer cannot resume; a new authorized offer is required.
Authority outages fail closed for WebRTC; the ordinary relay path continues to
apply its existing session checks. Deploy the relay protocol before upgrading
hosts to retain WebRTC during rollout. No deployment is performed by this change.
