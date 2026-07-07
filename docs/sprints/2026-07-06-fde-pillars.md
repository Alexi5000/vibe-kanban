# Sprint: FDE Pillars Build-Out

Date: 2026-07-06
Branch: `agent/fde-pillars`
Contract: v1 (`contracts/schema.json`)

## Goal

Bring the fork to FDE production level: all twelve pillars present, every
runnable gate green locally and in CI, with claims scoped to what the gates
actually prove.

## Shipped

| Pillars | Delivery |
|---|---|
| 3, 4, 5, 6, 12 | `packages/fde` (`@vibe/fde`): zod sprint contracts exported as versioned JSON Schema, Planner/Generator/Evaluator harness, four-axis grader, plateau scorer + tracker, 12 fixtures (5 golden / 7 adversarial), 51 vitest tests |
| 7 | `notebooks/` authoring surface + `notebooks:check` gate |
| 8 | Root `docker-compose.yml` over the existing root `Dockerfile`; remote stack stays in `crates/remote` |
| 2, 10, 11 | `docs/SKILLS_AND_TOOLS.md`, `docs/BENCHMARK.md` + drift-checked summary artifact, ADRs 0001–0005, `docs/FDE_GATES.md` |
| 1, 9 | `AGENTS.md` FDE section, README rewrite with fork positioning |
| CI | `.github/workflows/fde.yml` running all runnable gates |

## Gate results (local, 2026-07-06)

- `pnpm run fde:check` — clean
- `pnpm run fde:test` — 51/51
- `pnpm run contracts:check` — hash `74f09da1…2798`
- `pnpm run fde:evals` — 12/12 scenarios behave as designed
- `pnpm run benchmark:check` — table matches artifact
- `pnpm run notebooks:check` — clean

## Notes

- Upstream is sunsetting; ADR 0005 records the honest scope boundary.
- No cargo on the FDE workstation; Rust gates remain CI-only (ADR 0001).
