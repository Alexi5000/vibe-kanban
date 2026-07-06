import { describe, expect, it } from 'vitest';
import type { BoardAction } from '../src/contracts/sprint';
import { generateBoardActions } from '../src/harness/generator';
import { planSprint } from '../src/harness/planner';
import { tamperActions } from '../src/harness/tamper';

const briefInput = {
  id: 'chain',
  title: 'Chain',
  objective: 'O',
  tasks: [
    { key: 'a', title: 'A', agent: 'kat' },
    { key: 'b', title: 'B', agent: 'kat', dependsOn: ['a'] },
  ],
  constraints: {},
};

function setup() {
  const outcome = planSprint(briefInput);
  if (!outcome.ok) throw new Error('plan failed');
  return { plan: outcome.plan, actions: generateBoardActions(outcome.plan) };
}

function transitions(actions: BoardAction[]) {
  return actions.filter(
    (action): action is Extract<BoardAction, { kind: 'set_status' }> =>
      action.kind === 'set_status',
  );
}

describe('tamper', () => {
  it('skip_review removes review states and rewires done transitions', () => {
    const { plan, actions } = setup();
    const tampered = tamperActions('skip_review', actions, plan);
    const moves = transitions(tampered);
    expect(moves.every((move) => move.to !== 'inreview')).toBe(true);
    expect(
      moves.filter((move) => move.from === 'inprogress' && move.to === 'done'),
    ).toHaveLength(2);
  });

  it('illegal_jump turns the first start into todo -> done', () => {
    const { plan, actions } = setup();
    const moves = transitions(tamperActions('illegal_jump', actions, plan));
    expect(moves[0]).toMatchObject({ from: 'todo', to: 'done' });
  });

  it('ignore_dependencies executes task groups in reverse plan order', () => {
    const { plan, actions } = setup();
    const moves = transitions(tamperActions('ignore_dependencies', actions, plan));
    expect(moves[0].taskKey).toBe('b');
    expect(moves.at(-1)?.taskKey).toBe('a');
  });

  it('orphan_task appends actions for a task outside the plan', () => {
    const { plan, actions } = setup();
    const tampered = tamperActions('orphan_task', actions, plan);
    expect(tampered.at(-2)).toMatchObject({ kind: 'create_task', taskKey: 'ghost-task' });
    expect(tampered.at(-1)).toMatchObject({ kind: 'set_status', taskKey: 'ghost-task' });
  });

  it('terminal_mutation appends a done -> inprogress action', () => {
    const { plan, actions } = setup();
    const tampered = tamperActions('terminal_mutation', actions, plan);
    expect(tampered.at(-1)).toMatchObject({ from: 'done', to: 'inprogress', taskKey: 'a' });
  });

  it('wip_flood front-loads every start before any finish', () => {
    const { plan, actions } = setup();
    const moves = transitions(tamperActions('wip_flood', actions, plan));
    const startIndexes = moves
      .map((move, index) => (move.to === 'inprogress' && move.from === 'todo' ? index : -1))
      .filter((index) => index >= 0);
    const finishIndexes = moves
      .map((move, index) => (move.to === 'done' || move.to === 'inreview' ? index : -1))
      .filter((index) => index >= 0);
    expect(Math.max(...startIndexes)).toBeLessThan(Math.min(...finishIndexes));
  });
});
