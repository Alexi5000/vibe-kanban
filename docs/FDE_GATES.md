# FDE Gates

The twelve pillars, each with its proof artifact and the command that checks
it. A pillar without a runnable gate is listed with its verification method.

| # | Pillar | Proof artifact | Gate |
|---|---|---|---|
| 1 | Agent-legible procedural memory | `AGENTS.md` (root, + nested guides), FDE section included | review |
| 2 | Skills vs. tools distinction | `docs/SKILLS_AND_TOOLS.md` | review |
| 3 | Typed, versioned sprint contracts | `contracts/schema.json` + `contracts/schema.sha256` | `pnpm run contracts:check` |
| 4 | Three-agent adversarial harness | `packages/fde/src/harness/` (Planner → Generator → Evaluator) | `pnpm run fde:evals` |
| 5 | Four-axis grader | `packages/fde/src/scoring/grader.ts` | `pnpm run fde:test` |
| 6 | Plateau-detection scorer | `packages/fde/src/scoring/plateau.ts` (pure fn + composable tracker) | `pnpm run fde:test` |
| 7 | Notebook authoring surface | `notebooks/` (clean, artifact-reading) | `pnpm run notebooks:check` |
| 8 | Containerization | root `Dockerfile` + `docker-compose.yml`; remote stack in `crates/remote/` | `docker compose config` (needs Docker; YAML-validated otherwise) |
| 9 | FDE-narrative README | `README.md` (customer problem first, honest proof section) | review |
| 10 | Honest benchmark doc | `docs/BENCHMARK.md` + `docs/benchmark/offline-eval-summary.json` | `pnpm run benchmark:check` |
| 11 | Architecture Decision Records | `docs/adr/0001`–`0005` | review |
| 12 | Test coverage for the new surface | `packages/fde/tests/` (51 tests, 9 files) | `pnpm run fde:test` |

## Run every local gate

```bash
pnpm install --filter @vibe/fde
pnpm run fde:check && \
pnpm run fde:test && \
pnpm run contracts:check && \
pnpm run fde:evals && \
pnpm run benchmark:check && \
pnpm run notebooks:check
```

## CI split

- `.github/workflows/fde.yml` — runs the gates above on FDE-surface changes.
- `.github/workflows/test.yml` — upstream path-filtered workflow; keeps
  validating the Rust workspace (`cargo test --workspace`) and the frontend.
  The FDE layer deliberately does not touch those paths.

## Scope note

FDE certification covers the **orchestration core** (contracts, harness,
grading, and the documented workflows). The Tauri desktop app, relay/WebRTC
infrastructure, and remote deployment stack are validated by upstream's test
suite and release pipelines, not by these gates.
