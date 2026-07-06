import type {
  BoardAction,
  ScenarioBrief,
  SprintPlan,
  TaskStatus,
} from '../contracts/sprint';
import { isLegalTransition } from '../domain/state-machine';

export type ReplayIssue = {
  code: string;
  severity: 'error' | 'warn';
  message: string;
};

export type ReplayReport = {
  scenarioId: string;
  issues: ReplayIssue[];
  finalStatuses: Record<string, TaskStatus>;
  totalActions: number;
};

// Evaluator: replays the Generator's action stream against the contract state
// machine and the plan's policy constraints, recording every violation.
export function replayBoardRun(
  brief: ScenarioBrief,
  plan: SprintPlan,
  actions: BoardAction[],
): ReplayReport {
  const issues: ReplayIssue[] = [];
  const statuses = new Map<string, TaskStatus>();
  const plannedKeys = new Set(plan.orderedTaskKeys);
  const depsByKey = new Map(brief.tasks.map((task) => [task.key, task.dependsOn]));

  for (const action of actions) {
    if (action.kind === 'create_task') {
      if (!plannedKeys.has(action.taskKey)) {
        issues.push({
          code: `task_not_in_plan:${action.taskKey}`,
          severity: 'error',
          message: `Task ${action.taskKey} was created but is not part of the sprint plan.`,
        });
      }
      if (statuses.has(action.taskKey)) {
        issues.push({
          code: `duplicate_create:${action.taskKey}`,
          severity: 'error',
          message: `Task ${action.taskKey} was created twice.`,
        });
        continue;
      }
      statuses.set(action.taskKey, 'todo');
      continue;
    }

    const current = statuses.get(action.taskKey);
    if (current === undefined) {
      issues.push({
        code: `unknown_task:${action.taskKey}`,
        severity: 'error',
        message: `Status change for ${action.taskKey}, which was never created.`,
      });
      continue;
    }
    if (action.from !== current) {
      issues.push({
        code: `stale_from:${action.taskKey}`,
        severity: 'error',
        message: `Action claims ${action.taskKey} is ${action.from} but board shows ${current}.`,
      });
      continue;
    }
    if (!isLegalTransition(action.from, action.to)) {
      issues.push({
        code: `illegal_transition:${action.taskKey}:${action.from}->${action.to}`,
        severity: 'error',
        message: `Transition ${action.from} -> ${action.to} is not allowed by the board state machine.`,
      });
      continue;
    }

    if (plan.requireReview && action.from === 'inprogress' && action.to === 'done') {
      issues.push({
        code: `review_skipped:${action.taskKey}`,
        severity: 'error',
        message: `Task ${action.taskKey} moved to done without passing review.`,
      });
    }
    if (action.to === 'inprogress' && plannedKeys.has(action.taskKey)) {
      const unmetDeps = (depsByKey.get(action.taskKey) ?? []).filter(
        (dep) => statuses.get(dep) !== 'done',
      );
      for (const dep of unmetDeps) {
        issues.push({
          code: `dependency_violation:${action.taskKey}->${dep}`,
          severity: 'error',
          message: `Task ${action.taskKey} started before dependency ${dep} was done.`,
        });
      }
    }
    if (action.from === 'inreview' && action.to === 'inprogress') {
      issues.push({
        code: `rework_cycle:${action.taskKey}`,
        severity: 'warn',
        message: `Task ${action.taskKey} was sent back from review.`,
      });
    }

    statuses.set(action.taskKey, action.to);

    if (action.to === 'inprogress' && plannedKeys.has(action.taskKey)) {
      const agent = plan.assignments[action.taskKey] ?? 'unassigned';
      const wip = [...statuses.entries()].filter(
        ([key, status]) =>
          status === 'inprogress' && (plan.assignments[key] ?? 'unassigned') === agent,
      ).length;
      if (wip > plan.maxWipPerAgent) {
        issues.push({
          code: `wip_limit_exceeded:${agent}`,
          severity: 'error',
          message: `Agent ${agent} has ${wip} tasks in progress (limit ${plan.maxWipPerAgent}).`,
        });
      }
    }
  }

  return {
    scenarioId: brief.id,
    issues,
    finalStatuses: Object.fromEntries(statuses),
    totalActions: actions.length,
  };
}
