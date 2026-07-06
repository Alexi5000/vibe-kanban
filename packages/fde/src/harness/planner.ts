import {
  CONTRACT_VERSION,
  ScenarioBriefSchema,
  type ScenarioBrief,
  type SprintPlan,
} from '../contracts/sprint';

export type PlanOutcome =
  | { ok: true; plan: SprintPlan }
  | { ok: false; issues: string[] };

export function planSprint(briefInput: unknown): PlanOutcome {
  const parsed = ScenarioBriefSchema.safeParse(briefInput);
  if (!parsed.success) {
    return {
      ok: false,
      issues: parsed.error.issues.map(
        (issue) => `brief_invalid:${issue.path.join('.')}:${issue.code}`,
      ),
    };
  }

  const brief = parsed.data;
  const issues: string[] = [];
  const keys = new Set<string>();
  for (const task of brief.tasks) {
    if (keys.has(task.key)) issues.push(`duplicate_task_key:${task.key}`);
    keys.add(task.key);
  }
  for (const task of brief.tasks) {
    for (const dep of task.dependsOn) {
      if (dep === task.key) issues.push(`self_dependency:${task.key}`);
      else if (!keys.has(dep)) issues.push(`unknown_dependency:${task.key}->${dep}`);
    }
  }
  if (issues.length) return { ok: false, issues };

  const ordered = topologicalOrder(brief);
  if (!ordered) return { ok: false, issues: ['dependency_cycle'] };

  return {
    ok: true,
    plan: {
      contractVersion: CONTRACT_VERSION,
      scenarioId: brief.id,
      orderedTaskKeys: ordered,
      assignments: Object.fromEntries(
        brief.tasks.map((task) => [task.key, task.agent]),
      ),
      maxWipPerAgent: brief.constraints.maxWipPerAgent,
      requireReview: brief.constraints.requireReview,
    },
  };
}

// Kahn's algorithm with alphabetical tie-breaking so plans are deterministic.
function topologicalOrder(brief: ScenarioBrief): string[] | null {
  const remainingDeps = new Map<string, Set<string>>();
  const dependents = new Map<string, string[]>();
  for (const task of brief.tasks) {
    remainingDeps.set(task.key, new Set(task.dependsOn));
    for (const dep of task.dependsOn) {
      dependents.set(dep, [...(dependents.get(dep) ?? []), task.key]);
    }
  }

  const ready = [...remainingDeps.entries()]
    .filter(([, deps]) => deps.size === 0)
    .map(([key]) => key)
    .sort();
  const ordered: string[] = [];

  while (ready.length) {
    const key = ready.shift()!;
    ordered.push(key);
    for (const dependent of dependents.get(key) ?? []) {
      const deps = remainingDeps.get(dependent)!;
      deps.delete(key);
      if (deps.size === 0) {
        ready.push(dependent);
        ready.sort();
      }
    }
  }

  return ordered.length === brief.tasks.length ? ordered : null;
}
