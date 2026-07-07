# Notebooks

This directory is an **authoring surface, not a runtime**. Notebooks here are
for exploring and writing up FDE eval results; nothing in the product or CI
executes them. The committed benchmark artifacts they read
(`docs/benchmark/offline-eval-summary.json`, `contracts/schema.json`) are
produced by the deterministic harness in `packages/fde`, never by a notebook.

## Rules

- Notebooks must be committed **clean**: no cell outputs, no execution counts.
  `pnpm run notebooks:check` enforces this.
- Notebooks read committed artifacts; they never mutate repo state.
- Python stdlib only (`json`, `statistics`, `pathlib`) so anyone can run them
  without an environment setup.

## Contents

- `orchestration-eval-template.ipynb` — starting point for analyzing an
  offline eval run: per-fixture pass matrix, four-axis score breakdown, and
  plateau inspection across successive runs.

## Workflow

1. Run `pnpm run fde:evals` to regenerate `docs/benchmark/offline-eval-summary.json`.
2. Copy the template, explore, and write up findings.
3. Clear all outputs before committing (`Edit > Clear All Outputs` or
   `jupyter nbconvert --clear-output`).
4. `pnpm run notebooks:check` must pass.
