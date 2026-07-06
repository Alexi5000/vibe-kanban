import { describe, expect, it } from 'vitest';
import {
  createPlateauTracker,
  scoreOrchestrationPlateau,
} from '../src/scoring/plateau';

const baseInput = {
  iteration: 3,
  tasksDone: 5,
  previousTasksDone: 5,
  openViolations: 0,
  reworkCount: 0,
  remainingActionBudget: 10,
};

describe('scoreOrchestrationPlateau', () => {
  it('continues while violations are open', () => {
    const decision = scoreOrchestrationPlateau({ ...baseInput, openViolations: 2 });
    expect(decision.shouldContinue).toBe(true);
    expect(decision.reasons).toContain('violations_open');
  });

  it('continues while the board is making progress', () => {
    const decision = scoreOrchestrationPlateau({
      ...baseInput,
      tasksDone: 6,
    });
    expect(decision.shouldContinue).toBe(true);
    expect(decision.reasons).toContain('board_progress');
  });

  it('stops hard when the action budget is exhausted', () => {
    const decision = scoreOrchestrationPlateau({
      ...baseInput,
      openViolations: 3,
      remainingActionBudget: 0,
    });
    expect(decision.shouldContinue).toBe(false);
    expect(decision.reasons).toContain('budget_exhausted');
  });

  it('flags a marginal-gain plateau once progress flatlines', () => {
    const decision = scoreOrchestrationPlateau(baseInput);
    expect(decision.shouldContinue).toBe(false);
    expect(decision.reasons).toContain('marginal_gain_plateau');
  });

  it('keeps early empty iterations alive via the progress floor', () => {
    const decision = scoreOrchestrationPlateau({
      ...baseInput,
      iteration: 0,
      tasksDone: 0,
      previousTasksDone: 0,
    });
    expect(decision.shouldContinue).toBe(true);
    expect(decision.reasons).toContain('minimum_progress_floor_not_met');
  });
});

describe('createPlateauTracker', () => {
  it('flags a plateau after a flat window of observations', () => {
    const tracker = createPlateauTracker({ window: 3, epsilon: 0.01 });
    expect(tracker.observe(0.5).plateaued).toBe(false);
    expect(tracker.observe(0.5).plateaued).toBe(false);
    const third = tracker.observe(0.505);
    expect(third.plateaued).toBe(true);
    expect(third.samples).toBe(3);
  });

  it('does not flag while scores keep moving', () => {
    const tracker = createPlateauTracker({ window: 3, epsilon: 0.01 });
    tracker.observe(0.2);
    tracker.observe(0.4);
    const third = tracker.observe(0.6);
    expect(third.plateaued).toBe(false);
    expect(third.delta).toBeCloseTo(0.4);
    expect(tracker.history()).toEqual([0.2, 0.4, 0.6]);
  });
});
