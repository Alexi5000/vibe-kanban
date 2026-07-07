# ADR 0003: Deterministic offline three-agent harness with adversarial negative controls

Status: Accepted (2026-07-06)

## Context

The FDE framework requires a Planner → Generator → Evaluator adversarial
harness. Running live LLMs in CI would make evals non-deterministic, cost
money per run, and require secrets in a public fork.

## Decision

All three roles are deterministic programs over fixed fixtures:

- **Planner** (`planSprint`) topologically sorts a scenario brief with
  alphabetical tie-breaks and refuses malformed or cyclic briefs.
- **Generator** (`generateBoardActions`) emits the canonical action stream;
  adversarial fixtures corrupt it through six typed tamper modes
  (`skip_review`, `illegal_jump`, `ignore_dependencies`, `orphan_task`,
  `terminal_mutation`, `wip_flood`).
- **Evaluator** (`replayBoardRun`) replays actions against the contract state
  machine and grades four axes.

Fixtures pin both the expected pass/fail outcome **and** the issue codes that
must be reported, so the Evaluator cannot pass a negative control for the
wrong reason.

## Consequences

- `pnpm run fde:evals` is free, offline, and byte-identical across runs, so
  the benchmark artifact can be committed and drift-checked.
- The harness proves the *referee* works. It does not measure live-agent
  quality; that boundary is documented in `docs/BENCHMARK.md`.
- New violation classes are added as tamper modes with matching fixtures —
  the negative-control pattern scales.
