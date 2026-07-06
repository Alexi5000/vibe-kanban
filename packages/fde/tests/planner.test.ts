import { describe, expect, it } from 'vitest';
import { planSprint } from '../src/harness/planner';

const fanoutBrief = {
  id: 'fanout',
  title: 'Fanout',
  objective: 'Test ordering',
  tasks: [
    { key: 'zeta', title: 'Zeta', agent: 'kat', dependsOn: ['root'] },
    { key: 'root', title: 'Root', agent: 'six' },
    { key: 'alpha', title: 'Alpha', agent: 'emile', dependsOn: ['root'] },
  ],
  constraints: {},
};

describe('planner', () => {
  it('produces a deterministic topological order with alphabetical tie-breaks', () => {
    const first = planSprint(fanoutBrief);
    const second = planSprint(fanoutBrief);
    expect(first.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    expect(first.plan.orderedTaskKeys).toEqual(['root', 'alpha', 'zeta']);
    expect(second.plan).toEqual(first.plan);
  });

  it('carries agent assignments and constraints into the plan', () => {
    const outcome = planSprint(fanoutBrief);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.plan.assignments).toEqual({
      zeta: 'kat',
      root: 'six',
      alpha: 'emile',
    });
    expect(outcome.plan.maxWipPerAgent).toBe(1);
    expect(outcome.plan.requireReview).toBe(true);
    expect(outcome.plan.contractVersion).toBe(1);
  });

  it('refuses cyclic dependency graphs', () => {
    const outcome = planSprint({
      id: 'cycle',
      title: 'Cycle',
      objective: 'Refuse me',
      tasks: [
        { key: 'a', title: 'A', agent: 'kat', dependsOn: ['b'] },
        { key: 'b', title: 'B', agent: 'kat', dependsOn: ['a'] },
      ],
      constraints: {},
    });
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.issues).toContain('dependency_cycle');
  });

  it('refuses unknown dependencies', () => {
    const outcome = planSprint({
      id: 'unknown-dep',
      title: 'Unknown dep',
      objective: 'Refuse me',
      tasks: [{ key: 'a', title: 'A', agent: 'kat', dependsOn: ['missing'] }],
      constraints: {},
    });
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.issues).toContain('unknown_dependency:a->missing');
  });

  it('refuses duplicate task keys and self-dependencies', () => {
    const outcome = planSprint({
      id: 'dupes',
      title: 'Dupes',
      objective: 'Refuse me',
      tasks: [
        { key: 'a', title: 'A', agent: 'kat' },
        { key: 'a', title: 'A again', agent: 'kat', dependsOn: ['a'] },
      ],
      constraints: {},
    });
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.issues).toContain('duplicate_task_key:a');
    expect(outcome.issues).toContain('self_dependency:a');
  });

  it('rejects briefs that fail schema validation', () => {
    const outcome = planSprint({ id: 'bad', tasks: [] });
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.issues.some((issue) => issue.startsWith('brief_invalid:'))).toBe(
      true,
    );
  });
});
