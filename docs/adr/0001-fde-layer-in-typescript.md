# ADR 0001: Build the FDE layer as a TypeScript pnpm package, not a Rust crate

Status: Accepted (2026-07-06)

## Context

vibe-kanban is a 33-crate Rust workspace plus a pnpm TS workspace. The FDE
surface (contracts, harness, grading) needs to be verifiable on the FDE
workstation, which has Node 22 and pnpm 10.13.1 but **no Rust toolchain**.
Rust gates only run in GitHub CI. Adding a 34th crate would also entangle the
new surface with a large build graph we must not destabilize while upstream
(BloopAI) is sunsetting.

## Decision

The FDE layer lives in `packages/fde` as a private workspace package
(`@vibe/fde`) with zod contracts, vitest tests, and tsx-run gate scripts. It
imports nothing from and exports nothing to the product code.

## Consequences

- Every FDE gate runs locally in seconds; no cargo required.
- Zero risk to the Rust build graph; upstream `test.yml` is untouched.
- The contract must mirror the Rust `TaskStatus` wire format by convention
  rather than by compiler-enforced sharing — mitigated by pinning tests
  (see ADR 0002).
