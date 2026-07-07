# ADR 0002: Ground the sprint contract in the Rust TaskStatus wire format

Status: Accepted (2026-07-06)

## Context

The harness evaluates board-action sequences against a task state machine. If
that machine drifted from the product's real one, the evals would certify
behavior the product does not have.

## Decision

The contract's status enum is copied verbatim from
`crates/db/src/models/task.rs` with its serde serialization
(`rename_all = "lowercase"`): `todo | inprogress | inreview | done |
cancelled`. Tests in `packages/fde/tests/state-machine.test.ts` and
`tests/contracts.test.ts` pin the exact values so any divergence fails the
suite.

Transitions are split into two layers:

- **Structural** (`TASK_STATUS_FLOW`): what the board physically allows,
  including the `inprogress -> done` fast track and `inreview -> inprogress`
  rework.
- **Policy** (evaluator checks): review requirements, WIP limits, dependency
  ordering — configured per scenario by the sprint contract.

## Consequences

- A structurally legal run can still fail policy (`skip-review-adversarial`
  demonstrates this), which is exactly how a real board behaves.
- If upstream's enum ever changes, the pinning tests point at the exact file
  to re-sync; regeneration is a one-line contract edit plus
  `pnpm run contracts:sync`.
