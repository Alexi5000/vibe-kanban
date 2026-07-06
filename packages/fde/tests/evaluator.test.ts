import { describe, expect, it } from 'vitest';
import type { BoardAction } from '../src/contracts/sprint';
import { ScenarioBriefSchema } from '../src/contracts/sprint';
import { planSprint } from '../src/harness/planner';
import { replayBoardRun } from '../src/harness/evaluator';

const briefInput = {
  id: 'eval-brief',
  title: 'Eval brief',
  objective: 'O',
  tasks: [{ key: 'work', title: 'Work', agent: 'kat' }],
  constraints: {},
};

function setup(input: unknown = briefInput) {
  const outcome = planSprint(input);
  if (!outcome.ok) throw new Error('plan failed');
  return {
    brief: ScenarioBriefSchema.parse(input),
    plan: outcome.plan,
  };
}

function codes(issues: { code: string }[]) {
  return issues.map((issue) => issue.code);
}

describe('evaluator', () => {
  it('flags status changes on tasks that were never created', () => {
    const { brief, plan } = setup();
    const actions: BoardAction[] = [
      { kind: 'set_status', taskKey: 'work', actor: 'kat', from: 'todo', to: 'inprogress' },
    ];
    const replay = replayBoardRun(brief, plan, actions);
    expect(codes(replay.issues)).toContain('unknown_task:work');
  });

  it('flags duplicate creates', () => {
    const { brief, plan } = setup();
    const actions: BoardAction[] = [
      { kind: 'create_task', taskKey: 'work', actor: 'kat' },
      { kind: 'create_task', taskKey: 'work', actor: 'kat' },
    ];
    const replay = replayBoardRun(brief, plan, actions);
    expect(codes(replay.issues)).toContain('duplicate_create:work');
  });

  it('flags actions whose from-state does not match the board', () => {
    const { brief, plan } = setup();
    const actions: BoardAction[] = [
      { kind: 'create_task', taskKey: 'work', actor: 'kat' },
      { kind: 'set_status', taskKey: 'work', actor: 'kat', from: 'inreview', to: 'done' },
    ];
    const replay = replayBoardRun(brief, plan, actions);
    expect(codes(replay.issues)).toContain('stale_from:work');
    expect(replay.finalStatuses.work).toBe('todo');
  });

  it('flags review skips as errors when the plan requires review', () => {
    const { brief, plan } = setup();
    const actions: BoardAction[] = [
      { kind: 'create_task', taskKey: 'work', actor: 'kat' },
      { kind: 'set_status', taskKey: 'work', actor: 'kat', from: 'todo', to: 'inprogress' },
      { kind: 'set_status', taskKey: 'work', actor: 'kat', from: 'inprogress', to: 'done' },
    ];
    const replay = replayBoardRun(brief, plan, actions);
    expect(codes(replay.issues)).toContain('review_skipped:work');
    expect(replay.finalStatuses.work).toBe('done');
  });

  it('records rework cycles as warnings, not errors', () => {
    const { brief, plan } = setup();
    const actions: BoardAction[] = [
      { kind: 'create_task', taskKey: 'work', actor: 'kat' },
      { kind: 'set_status', taskKey: 'work', actor: 'kat', from: 'todo', to: 'inprogress' },
      { kind: 'set_status', taskKey: 'work', actor: 'kat', from: 'inprogress', to: 'inreview' },
      { kind: 'set_status', taskKey: 'work', actor: 'kat', from: 'inreview', to: 'inprogress' },
      { kind: 'set_status', taskKey: 'work', actor: 'kat', from: 'inprogress', to: 'inreview' },
      { kind: 'set_status', taskKey: 'work', actor: 'kat', from: 'inreview', to: 'done' },
    ];
    const replay = replayBoardRun(brief, plan, actions);
    expect(replay.issues).toEqual([
      expect.objectContaining({ code: 'rework_cycle:work', severity: 'warn' }),
    ]);
    expect(replay.finalStatuses.work).toBe('done');
  });

  it('flags per-agent WIP limit breaches', () => {
    const multiInput = {
      id: 'wip',
      title: 'WIP',
      objective: 'O',
      tasks: [
        { key: 'one', title: 'One', agent: 'kat' },
        { key: 'two', title: 'Two', agent: 'kat' },
      ],
      constraints: { maxWipPerAgent: 1 },
    };
    const { brief, plan } = setup(multiInput);
    const actions: BoardAction[] = [
      { kind: 'create_task', taskKey: 'one', actor: 'kat' },
      { kind: 'create_task', taskKey: 'two', actor: 'kat' },
      { kind: 'set_status', taskKey: 'one', actor: 'kat', from: 'todo', to: 'inprogress' },
      { kind: 'set_status', taskKey: 'two', actor: 'kat', from: 'todo', to: 'inprogress' },
    ];
    const replay = replayBoardRun(brief, plan, actions);
    expect(codes(replay.issues)).toContain('wip_limit_exceeded:kat');
  });

  it('flags dependency violations when a task starts too early', () => {
    const chainInput = {
      id: 'chain',
      title: 'Chain',
      objective: 'O',
      tasks: [
        { key: 'first', title: 'First', agent: 'kat' },
        { key: 'second', title: 'Second', agent: 'emile', dependsOn: ['first'] },
      ],
      constraints: {},
    };
    const { brief, plan } = setup(chainInput);
    const actions: BoardAction[] = [
      { kind: 'create_task', taskKey: 'first', actor: 'kat' },
      { kind: 'create_task', taskKey: 'second', actor: 'emile' },
      { kind: 'set_status', taskKey: 'second', actor: 'emile', from: 'todo', to: 'inprogress' },
    ];
    const replay = replayBoardRun(brief, plan, actions);
    expect(codes(replay.issues)).toContain('dependency_violation:second->first');
  });
});
