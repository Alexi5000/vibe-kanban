# Benchmark: Offline Orchestration Eval

Honest scope, stated up front:

- **What this measures.** The deterministic offline harness in `packages/fde`
  runs 12 fixed scenarios through a Planner → Generator → Evaluator pipeline
  and grades each run on four axes. It proves that the contract state machine,
  the policy checks, and the grader catch every violation class they claim to
  catch — including 7 adversarial negative controls designed to sneak past
  them.
- **What this does NOT measure.** No live LLMs, no real coding agents, no
  network, no wall-clock performance. Scenario briefs are synthetic. The Rust
  product core is **not** certified by this suite — its proof is the upstream
  test suite (263 Rust test functions) run by `.github/workflows/test.yml`.

## Reproduce

```bash
pnpm install --filter @vibe/fde
pnpm run fde:test        # 51 vitest tests
pnpm run fde:evals       # regenerates docs/benchmark/offline-eval-summary.json
pnpm run benchmark:check # verifies this document matches the committed summary
```

The suite is fully deterministic: same fixtures, same scores, same artifact,
every run. `benchmark:check` fails CI if this table drifts from
`docs/benchmark/offline-eval-summary.json`.

## Results — suite `agent-orchestration-offline` (contract v1)

12/12 scenarios behave as designed. On adversarial rows, "Observed: Fail" is
the success condition: the Evaluator caught the violation.

| Fixture | Expected | Observed | Scores | Issues |
|---|---|---|---|---|
| `single-task-happy-path` | Pass | Pass | C 1.00 / S 1.00 / Comp 1.00 / Q 1.00 | None |
| `linear-dependency-chain` | Pass | Pass | C 1.00 / S 1.00 / Comp 1.00 / Q 1.00 | None |
| `parallel-agents-fanout` | Pass | Pass | C 1.00 / S 1.00 / Comp 1.00 / Q 1.00 | None |
| `no-review-fast-track` | Pass | Pass | C 1.00 / S 1.00 / Comp 1.00 / Q 1.00 | None |
| `diamond-dependency` | Pass | Pass | C 1.00 / S 1.00 / Comp 1.00 / Q 1.00 | None |
| `skip-review-adversarial` | Fail | Fail | C 1.00 / S 0.50 / Comp 1.00 / Q 1.00 | review_skipped:feature-a, review_skipped:feature-b |
| `illegal-status-jump-adversarial` | Fail | Fail | C 0.25 / S 1.00 / Comp 0.00 / Q 1.00 | illegal_transition:jump-task:todo->done, stale_from:jump-task |
| `dependency-inversion-adversarial` | Fail | Fail | C 1.00 / S 0.50 / Comp 1.00 / Q 1.00 | dependency_violation:third->second, dependency_violation:second->first |
| `orphan-task-adversarial` | Fail | Fail | C 0.83 / S 1.00 / Comp 1.00 / Q 1.00 | task_not_in_plan:ghost-task |
| `terminal-mutation-adversarial` | Fail | Fail | C 0.80 / S 1.00 / Comp 1.00 / Q 1.00 | illegal_transition:finished-task:done->inprogress |
| `wip-flood-adversarial` | Fail | Fail | C 1.00 / S 0.50 / Comp 1.00 / Q 1.00 | wip_limit_exceeded:kat (x2) |
| `cyclic-dependencies-adversarial` | Fail | Fail | C 0.00 / S 1.00 / Comp 0.00 / Q 0.00 | planner:dependency_cycle |

## Reading the four axes

- **Correctness (C)** — fraction of actions that were structurally valid
  against the board state machine (`crates/db/src/models/task.rs` ground
  truth: `todo | inprogress | inreview | done | cancelled`).
- **Safety (S)** — 0.25 deducted per policy violation (skipped review, WIP
  limit breach, dependency violation). A run can be structurally correct and
  still unsafe — `skip-review-adversarial` is exactly that case.
- **Completeness (Comp)** — fraction of the brief's tasks that reached `done`.
- **Quality (Q)** — deductions for warning-level signals such as rework
  cycles.

A scenario passes only when the run has zero error-severity issues **and**
completeness is 1.00. Fixtures additionally pin the exact issue codes the
Evaluator must report, so a negative control that fails for the wrong reason
fails the suite.

## Known limitations

- The Generator is canonical and sequential; concurrency is modeled only
  through action ordering, not real parallel execution.
- Containerization proof is limited: the root `docker-compose.yml` is
  YAML-validated locally (no Docker daemon in the FDE workstation sandbox);
  image builds run in release CI.
- Plateau detection is exercised by unit tests and the analysis notebook, not
  by a long-horizon live run.
