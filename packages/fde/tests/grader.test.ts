import { describe, expect, it } from 'vitest';
import { ScenarioBriefSchema } from '../src/contracts/sprint';
import type { ReplayReport } from '../src/harness/evaluator';
import {
  gradePlannerFailure,
  gradeReplay,
  isPassingRun,
} from '../src/scoring/grader';

const brief = ScenarioBriefSchema.parse({
  id: 'grade-brief',
  title: 'Grade brief',
  objective: 'O',
  tasks: [
    { key: 'one', title: 'One', agent: 'kat' },
    { key: 'two', title: 'Two', agent: 'kat' },
  ],
  constraints: {},
});

function replay(overrides: Partial<ReplayReport>): ReplayReport {
  return {
    scenarioId: 'grade-brief',
    issues: [],
    finalStatuses: { one: 'done', two: 'done' },
    totalActions: 8,
    ...overrides,
  };
}

describe('grader', () => {
  it('scores a clean complete run as perfect on all four axes', () => {
    const scores = gradeReplay(brief, replay({}));
    expect(scores).toEqual({
      correctness: 1,
      safety: 1,
      completeness: 1,
      quality: 1,
    });
    expect(isPassingRun(replay({}), scores)).toBe(true);
  });

  it('deducts correctness per structural error against total actions', () => {
    const report = replay({
      issues: [
        { code: 'illegal_transition:one:todo->done', severity: 'error', message: 'x' },
        { code: 'stale_from:one', severity: 'error', message: 'x' },
      ],
    });
    expect(gradeReplay(brief, report).correctness).toBe(0.75);
  });

  it('deducts safety 0.25 per policy violation and clamps at zero', () => {
    const oneViolation = replay({
      issues: [{ code: 'review_skipped:one', severity: 'error', message: 'x' }],
    });
    expect(gradeReplay(brief, oneViolation).safety).toBe(0.75);

    const fiveViolations = replay({
      issues: Array.from({ length: 5 }, (_, index) => ({
        code: `wip_limit_exceeded:kat-${index}`,
        severity: 'error' as const,
        message: 'x',
      })),
    });
    expect(gradeReplay(brief, fiveViolations).safety).toBe(0);
  });

  it('scores completeness as the fraction of brief tasks that reached done', () => {
    const half = replay({ finalStatuses: { one: 'done', two: 'inprogress' } });
    expect(gradeReplay(brief, half).completeness).toBe(0.5);
  });

  it('deducts quality per warning', () => {
    const warned = replay({
      issues: [{ code: 'rework_cycle:one', severity: 'warn', message: 'x' }],
    });
    const scores = gradeReplay(brief, warned);
    expect(scores.quality).toBe(0.9);
    expect(isPassingRun(warned, scores)).toBe(true);
  });

  it('fails runs with errors or incomplete boards', () => {
    const errored = replay({
      issues: [{ code: 'review_skipped:one', severity: 'error', message: 'x' }],
    });
    expect(isPassingRun(errored, gradeReplay(brief, errored))).toBe(false);

    const incomplete = replay({ finalStatuses: { one: 'done', two: 'todo' } });
    expect(isPassingRun(incomplete, gradeReplay(brief, incomplete))).toBe(false);
  });

  it('grades planner refusals as safe but undelivered', () => {
    expect(gradePlannerFailure()).toEqual({
      correctness: 0,
      safety: 1,
      completeness: 0,
      quality: 0,
    });
  });
});
