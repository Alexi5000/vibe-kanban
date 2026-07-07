import { describe, expect, it } from 'vitest';
import { ScenarioBriefSchema } from '../src/contracts/sprint';
import { generateBoardActions } from '../src/harness/generator';
import { planSprint } from '../src/harness/planner';
import { replayBoardRun } from '../src/harness/evaluator';

function planOrThrow(brief: unknown) {
  const outcome = planSprint(brief);
  if (!outcome.ok) throw new Error(`plan failed: ${outcome.issues.join(', ')}`);
  return outcome.plan;
}

describe('generator', () => {
  it('emits the canonical reviewed sequence for a single task', () => {
    const plan = planOrThrow({
      id: 's',
      title: 'S',
      objective: 'O',
      tasks: [{ key: 'only', title: 'Only', agent: 'kat' }],
      constraints: {},
    });
    expect(generateBoardActions(plan)).toEqual([
      { kind: 'create_task', taskKey: 'only', actor: 'kat' },
      { kind: 'set_status', taskKey: 'only', actor: 'kat', from: 'todo', to: 'inprogress' },
      { kind: 'set_status', taskKey: 'only', actor: 'kat', from: 'inprogress', to: 'inreview' },
      { kind: 'set_status', taskKey: 'only', actor: 'kat', from: 'inreview', to: 'done' },
    ]);
  });

  it('fast-tracks when review is disabled', () => {
    const plan = planOrThrow({
      id: 's',
      title: 'S',
      objective: 'O',
      tasks: [{ key: 'only', title: 'Only', agent: 'kat' }],
      constraints: { requireReview: false },
    });
    const transitions = generateBoardActions(plan).filter(
      (action) => action.kind === 'set_status',
    );
    expect(transitions.map((action) => action.to)).toEqual(['inprogress', 'done']);
  });

  it('produces a violation-free replay that completes every task', () => {
    const briefInput = {
      id: 'chain',
      title: 'Chain',
      objective: 'O',
      tasks: [
        { key: 'a', title: 'A', agent: 'kat' },
        { key: 'b', title: 'B', agent: 'kat', dependsOn: ['a'] },
        { key: 'c', title: 'C', agent: 'emile', dependsOn: ['b'] },
      ],
      constraints: {},
    };
    const plan = planOrThrow(briefInput);
    const brief = ScenarioBriefSchema.parse(briefInput);
    const replay = replayBoardRun(brief, plan, generateBoardActions(plan));
    expect(replay.issues).toEqual([]);
    expect(Object.values(replay.finalStatuses)).toEqual(['done', 'done', 'done']);
  });
});
