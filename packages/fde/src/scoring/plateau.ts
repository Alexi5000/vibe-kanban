export type PlateauInput = {
  iteration: number;
  tasksDone: number;
  previousTasksDone: number;
  openViolations: number;
  reworkCount: number;
  remainingActionBudget: number;
};

export type PlateauDecision = {
  shouldContinue: boolean;
  score: number;
  reasons: string[];
};

// Pure scorer: decides whether another orchestration iteration is worth
// running. Budget exhaustion is a hard stop regardless of score.
export function scoreOrchestrationPlateau(input: PlateauInput): PlateauDecision {
  const growth = Math.max(0, input.tasksDone - input.previousTasksDone);
  const reasons: string[] = [];
  let score = 0;

  if (input.openViolations > 0) {
    score += 4;
    reasons.push('violations_open');
  }
  if (growth >= 1) {
    score += 3;
    reasons.push('board_progress');
  }
  if (input.reworkCount > 0) {
    score += 1;
    reasons.push('rework_in_flight');
  }
  if (input.remainingActionBudget <= 0) {
    reasons.push('budget_exhausted');
    return { shouldContinue: false, score, reasons };
  }
  if (input.iteration < 2 && input.tasksDone === 0) {
    score += 3;
    reasons.push('minimum_progress_floor_not_met');
  }
  if (growth === 0 && input.iteration >= 2) {
    reasons.push('marginal_gain_plateau');
  }

  return {
    shouldContinue: score >= 3,
    score,
    reasons: reasons.length ? reasons : ['board_settled'],
  };
}

export type PlateauTracker = {
  observe(score: number): { plateaued: boolean; delta: number; samples: number };
  history(): number[];
};

// Composable wrapper: feed it any scalar score series (e.g. suite completeness
// across runs) and it flags when the last `window` observations are flat.
export function createPlateauTracker(
  options: { window?: number; epsilon?: number } = {},
): PlateauTracker {
  const window = options.window ?? 3;
  const epsilon = options.epsilon ?? 0.01;
  const history: number[] = [];

  return {
    observe(score: number) {
      history.push(score);
      const recent = history.slice(-window);
      const delta =
        recent.length < 2 ? 0 : Math.max(...recent) - Math.min(...recent);
      const plateaued = recent.length >= window && delta <= epsilon;
      return { plateaued, delta, samples: history.length };
    },
    history() {
      return [...history];
    },
  };
}
