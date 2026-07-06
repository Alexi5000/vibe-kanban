# ADR 0005: Scope FDE certification to the orchestration core

Status: Accepted (2026-07-06)

## Context

This fork carries heavy infrastructure surface: a Tauri desktop app,
relay/WebRTC tunneling, embedded SSH, and a remote deployment stack with
Postgres and ElectricSQL. Upstream (BloopAI) is sunsetting, so no further
upstream fixes are coming. Claiming FDE-level proof over all of that surface
would be dishonest — we cannot run its full validation locally, and we did
not build it.

## Decision

FDE gates certify the **orchestration core** only: the sprint contract, the
state machine, the harness, grading, and the documented agent workflows. The
Rust product code keeps its existing proof: 263 upstream Rust test functions
and the path-filtered `.github/workflows/test.yml`. The relay/remote/Tauri
surfaces are explicitly out of FDE scope (see `docs/FDE_GATES.md`).

## Consequences

- Every claim in `docs/BENCHMARK.md` is backed by a gate we actually run.
- Dependency freshness for the sunsetted upstream surface is tracked as fork
  risk, not hidden behind an FDE badge.
- If the fork later invests in the remote stack, it gets its own gates and
  its own ADR rather than inheriting this certification.
