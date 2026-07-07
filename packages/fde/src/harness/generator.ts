import type { BoardAction, SprintPlan } from '../contracts/sprint';

// Deterministic Generator: emits the canonical action sequence for a plan.
// Tasks execute fully sequentially in plan order, so per-agent WIP never
// exceeds one and dependencies (already topologically ordered) are honored.
export function generateBoardActions(plan: SprintPlan): BoardAction[] {
  const actions: BoardAction[] = [];
  for (const taskKey of plan.orderedTaskKeys) {
    actions.push({ kind: 'create_task', taskKey, actor: actorFor(plan, taskKey) });
  }
  for (const taskKey of plan.orderedTaskKeys) {
    const actor = actorFor(plan, taskKey);
    actions.push({ kind: 'set_status', taskKey, actor, from: 'todo', to: 'inprogress' });
    if (plan.requireReview) {
      actions.push({ kind: 'set_status', taskKey, actor, from: 'inprogress', to: 'inreview' });
      actions.push({ kind: 'set_status', taskKey, actor, from: 'inreview', to: 'done' });
    } else {
      actions.push({ kind: 'set_status', taskKey, actor, from: 'inprogress', to: 'done' });
    }
  }
  return actions;
}

function actorFor(plan: SprintPlan, taskKey: string): string {
  return plan.assignments[taskKey] ?? 'unassigned';
}
