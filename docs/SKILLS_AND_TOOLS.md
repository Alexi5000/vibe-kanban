# Skills vs. Tools

Agents working in this repo operate with two distinct kinds of capability.
Keeping them separate is deliberate: tools are audited API surface, skills are
versioned procedure. A new tool changes what an agent *can* do; a new skill
changes what it *should* do.

## Tools — deterministic surface an agent can invoke

| Tool surface | Where | What it does |
|---|---|---|
| MCP task server | `crates/mcp/src/task_server/` | The product's own agent-facing API: `create_session`, `run_session_prompt`, `list_sessions`, `update_session`, `get_context`, `get_execution`, `list_workspaces`, `update_workspace`, `delete_workspace`, plus issue/repo/organization tools |
| FDE harness API | `packages/fde/src/index.ts` | `planSprint`, `generateBoardActions`, `replayBoardRun`, `gradeReplay`, `scoreOrchestrationPlateau`, `runOfflineEvalSuite` |
| Gate scripts | `packages/fde/scripts/` | `contracts:sync` / `contracts:check`, `fde:evals`, `benchmark:check`, `notebooks:check` (all via root `pnpm run …`) |
| Product dev commands | root `package.json` | `pnpm run dev`, `pnpm run check`, `pnpm run generate-types`, `cargo test --workspace` |

Tool rules:

- Tools are typed. MCP tool schemas live in `shared/schemas/`; FDE harness
  types are the zod contracts in `packages/fde/src/contracts/sprint.ts`,
  exported as versioned JSON Schema in `contracts/schema.json`.
- Tools never encode judgment. `replayBoardRun` reports violations; it does
  not decide whether a sprint was "good". That is the grader's job, and the
  grader's policy is versioned with the contract.

## Skills — procedural knowledge an agent applies

| Skill | Where it is encoded |
|---|---|
| Working this codebase (type generation, SQLx prep, format/lint discipline) | `AGENTS.md` (root) + nested guides in `crates/remote/`, `docs/`, `packages/local-web/` |
| Planning a sprint from a brief (dependency ordering, WIP, review policy) | Planner role: `packages/fde/src/harness/planner.ts` |
| Executing board actions legally | Generator role: `packages/fde/src/harness/generator.ts` against the state machine in `packages/fde/src/domain/state-machine.ts` |
| Auditing another agent's run | Evaluator role: `packages/fde/src/harness/evaluator.ts` + four-axis grader |
| Knowing when to stop iterating | Plateau scorer: `packages/fde/src/scoring/plateau.ts` |
| Writing up eval results | `notebooks/README.md` workflow |

Skill rules:

- Skills live in files agents read, not in anyone's head. If a procedure
  matters, it belongs in `AGENTS.md` or a role module with tests.
- Skills are falsifiable. Every harness role has adversarial fixtures proving
  the skill's failure modes are caught (`packages/fde/src/fixtures/scenarios.ts`).
