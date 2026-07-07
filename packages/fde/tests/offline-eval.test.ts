import { describe, expect, it } from 'vitest';
import { EvalSuiteSummarySchema } from '../src/contracts/sprint';
import { fixtures } from '../src/fixtures/scenarios';
import { runOfflineEvalSuite } from '../src/harness/offline-eval';

describe('offline eval suite', () => {
  const summary = runOfflineEvalSuite();

  it('passes end to end with every fixture behaving as expected', () => {
    const failing = summary.results.filter((result) => !result.passed);
    expect(failing.map((result) => result.id)).toEqual([]);
    expect(summary.passed).toBe(true);
    expect(summary.failed).toBe(0);
    expect(summary.total).toBe(fixtures.length);
  });

  it('observes passes on positive fixtures and failures on negative controls', () => {
    for (const fixture of fixtures) {
      const result = summary.results.find((entry) => entry.id === fixture.id);
      expect(result, fixture.id).toBeDefined();
      expect(result!.observedPass, fixture.id).toBe(fixture.expectedPass);
    }
  });

  it('reports every expected issue code on adversarial fixtures', () => {
    for (const fixture of fixtures) {
      if (!fixture.expectedIssueCodes) continue;
      const result = summary.results.find((entry) => entry.id === fixture.id)!;
      for (const code of fixture.expectedIssueCodes) {
        expect(
          result.issues.some((issue) => issue.startsWith(code)),
          `${fixture.id} should report ${code}`,
        ).toBe(true);
      }
    }
  });

  it('exercises both halves of the suite', () => {
    const positives = fixtures.filter((fixture) => fixture.expectedPass).length;
    const negatives = fixtures.length - positives;
    expect(positives).toBeGreaterThanOrEqual(5);
    expect(negatives).toBeGreaterThanOrEqual(5);
  });

  it('is deterministic and schema-valid', () => {
    const second = runOfflineEvalSuite();
    expect(second).toEqual(summary);
    expect(() => EvalSuiteSummarySchema.parse(summary)).not.toThrow();
  });
});
