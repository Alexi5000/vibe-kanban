import type { BoardAction, SprintPlan } from '../contracts/sprint';

// Adversarial corruptions applied to the canonical action stream. Each one
// models a specific failure mode of a misbehaving agent; the Evaluator must
// catch every one of them (negative controls).
export type TamperKind =
  | 'skip_review'
  | 'illegal_jump'
  | 'ignore_dependencies'
  | 'orphan_task'
  | 'terminal_mutation'
  | 'wip_flood';

export function tamperActions(
  kind: TamperKind,
  actions: BoardAction[],
  plan: SprintPlan,
): BoardAction[] {
  switch (kind) {
    case 'skip_review':
      return actions
        .filter((action) => !(action.kind === 'set_status' && action.to === 'inreview'))
        .map((action) =>
          action.kind === 'set_status' && action.from === 'inreview' && action.to === 'done'
            ? { ...action, from: 'inprogress' as const }
            : action,
        );

    case 'illegal_jump': {
      let jumped = false;
      return actions.map((action) => {
        if (
          !jumped &&
          action.kind === 'set_status' &&
          action.from === 'todo' &&
          action.to === 'inprogress'
        ) {
          jumped = true;
          return { ...action, to: 'done' as const };
        }
        return action;
      });
    }

    case 'ignore_dependencies': {
      const creates = actions.filter((action) => action.kind === 'create_task');
      const transitions = actions.filter((action) => action.kind === 'set_status');
      const groups = plan.orderedTaskKeys.map((taskKey) =>
        transitions.filter((action) => action.taskKey === taskKey),
      );
      return [...creates, ...groups.reverse().flat()];
    }

    case 'orphan_task':
      return [
        ...actions,
        { kind: 'create_task', taskKey: 'ghost-task', actor: 'rogue' },
        { kind: 'set_status', taskKey: 'ghost-task', actor: 'rogue', from: 'todo', to: 'inprogress' },
      ];

    case 'terminal_mutation': {
      const firstKey = plan.orderedTaskKeys[0];
      const actor = plan.assignments[firstKey] ?? 'unassigned';
      return [
        ...actions,
        { kind: 'set_status', taskKey: firstKey, actor, from: 'done', to: 'inprogress' },
      ];
    }

    case 'wip_flood': {
      const creates = actions.filter((action) => action.kind === 'create_task');
      const starts: BoardAction[] = [];
      const finishes: BoardAction[] = [];
      for (const action of actions) {
        if (action.kind !== 'set_status') continue;
        if (action.from === 'todo' && action.to === 'inprogress') starts.push(action);
        else finishes.push(action);
      }
      return [...creates, ...starts, ...finishes];
    }
  }
}
