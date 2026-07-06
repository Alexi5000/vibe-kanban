# Repository Guidelines

## Project Structure & Module Organization
- `crates/`: Rust workspace crates — `server` (API + bins), `db` (SQLx models/migrations), `executors`, `services`, `utils`, `git` (Git operations), `api-types` (shared API types for local + remote), `review` (PR review tool), `deployment`, `local-deployment`, `remote`.
- `packages/local-web/`: Local React + TypeScript app entrypoint (Vite, Tailwind). Shell source in `packages/local-web/src`.
- `packages/remote-web/`: Remote deployment frontend entrypoint.
- `packages/web-core/`: Shared React + TypeScript frontend library used by local + remote web (`packages/web-core/src`).
- `shared/`: Generated TypeScript types (`shared/types.ts`, `shared/remote-types.ts`) and agent tool schemas (`shared/schemas/`). Do not edit generated files directly.
- `assets/`, `dev_assets_seed/`, `dev_assets/`: Packaged and local dev assets.
- `npx-cli/`: Files published to the npm CLI package.
- `scripts/`: Dev helpers (ports, DB preparation).
- `docs/`: Documentation files.

### Crate-specific guides
- [`crates/remote/AGENTS.md`](crates/remote/AGENTS.md) — Remote server architecture, ElectricSQL integration, mutation patterns, environment variables.
- [`docs/AGENTS.md`](docs/AGENTS.md) — Mintlify documentation writing guidelines and component reference.
- [`packages/local-web/AGENTS.md`](packages/local-web/AGENTS.md) — Web app design system styling guidelines.

## Managing Shared Types Between Rust and TypeScript

ts-rs allows you to derive TypeScript types from Rust structs/enums. By annotating your Rust types with #[derive(TS)] and related macros, ts-rs will generate .ts declaration files for those types.
When making changes to the types, you can regenerate them using `pnpm run generate-types`
Do not manually edit shared/types.ts, instead edit crates/server/src/bin/generate_types.rs

For remote/cloud types, regenerate using `pnpm run remote:generate-types`
Do not manually edit shared/remote-types.ts, instead edit crates/remote/src/bin/remote-generate-types.rs (see crates/remote/AGENTS.md for details).

## Build, Test, and Development Commands
- Install: `pnpm i`
- Run dev (web app + backend with ports auto-assigned): `pnpm run dev`
- Backend (watch): `pnpm run backend:dev:watch`
- Web app (dev): `pnpm run local-web:dev`
- Type checks: `pnpm run check` (frontend + all backend Rust workspaces) and `pnpm run backend:check` (all backend Rust workspaces, including `crates/remote`)
- Rust tests: `cargo test --workspace`
- Generate TS types from Rust: `pnpm run generate-types` (or `generate-types:check` in CI)
- Prepare SQLx (offline): `pnpm run prepare-db`
- Prepare SQLx (remote package, postgres): `pnpm run remote:prepare-db`
- Local NPX build: `pnpm run build:npx` then `pnpm pack` in `npx-cli/`
- Format code: `pnpm run format` (runs `cargo fmt` for all backend Rust workspaces + web-core/web Prettier)
- Lint: `pnpm run lint` (runs web/ui ESLint + `cargo clippy` for all backend Rust workspaces)

## Before Completing a Task
- Run `pnpm run format` to format all Rust workspaces and web code.

## Coding Style & Naming Conventions
- Rust: `rustfmt` enforced (`rustfmt.toml`); group imports by crate; snake_case modules, PascalCase types.
- TypeScript/React: ESLint + Prettier (2 spaces, single quotes, 80 cols). PascalCase components, camelCase vars/functions, kebab-case file names where practical.
- Keep functions small, add `Debug`/`Serialize`/`Deserialize` where useful.

## Testing Guidelines
- Rust: prefer unit tests alongside code (`#[cfg(test)]`), run `cargo test --workspace`. Add tests for new logic and edge cases.
- Web app: ensure `pnpm run check` and `pnpm run lint` pass. If adding runtime logic, include lightweight tests (e.g., Vitest) in the same directory.

## Security & Config Tips
- Use `.env` for local overrides; never commit secrets. Key envs: `FRONTEND_PORT`, `BACKEND_PORT`, `HOST` 
- Dev ports and assets are managed by `scripts/setup-dev-environment.js`.

## FDE Surface (`packages/fde`)

`packages/fde` (`@vibe/fde`) is the fork's orchestration-contract layer: typed
sprint contracts, a deterministic Planner → Generator → Evaluator harness,
a four-axis grader, and offline evals with adversarial negative controls. It
certifies the orchestration core only — see
[`docs/FDE_GATES.md`](docs/FDE_GATES.md) for the gate table and
[`docs/adr/`](docs/adr/) for the load-bearing decisions (scope boundary:
ADR 0005).

### Gates
- `pnpm run fde:check` — TypeScript type check of the FDE package
- `pnpm run fde:test` — vitest suite (51 tests)
- `pnpm run fde:evals` — offline eval suite; regenerates `docs/benchmark/offline-eval-summary.json`
- `pnpm run contracts:check` — committed `contracts/schema.json` + hash must match a fresh build
- `pnpm run benchmark:check` — committed eval summary + the table in `docs/BENCHMARK.md` must match a fresh run
- `pnpm run notebooks:check` — notebooks committed clean (no outputs, no execution counts)

### Rules
- Never hand-edit `contracts/schema.json` or `contracts/schema.sha256`; change
  the zod schemas in `packages/fde/src/contracts/` and run `pnpm run contracts:sync`.
- Never hand-edit `docs/benchmark/offline-eval-summary.json`; it is regenerated
  by `pnpm run fde:evals`. Keep the table in `docs/BENCHMARK.md` in sync — it
  is drift-checked.
- Keep the harness strictly deterministic: no clocks, no randomness, stable
  (alphabetical) orderings. Artifacts use `"generatedAt": "deterministic"`.
- The TS `TaskStatusSchema` mirrors the Rust serde wire format of `TaskStatus`
  in `crates/db/src/models/task.rs` (`rename_all = "lowercase"`). If the Rust
  enum changes, update the contract and regenerate artifacts (ADR 0002).
- New violation classes are added as tamper modes with matching adversarial
  fixtures that pin expected issue codes (ADR 0003).
- Rust gates (cargo) run in CI only; do not assume a local Rust toolchain
  (ADR 0001).


