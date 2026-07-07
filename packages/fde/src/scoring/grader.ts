import type { EvalScores, ScenarioBrief } from '../contracts/sprint';
import type { ReplayReport } from '../harness/evaluator';

const STRUCTURAL_CODES = [
  'unknown_task',
  'stale_from',
  'illegal_transition',
  'duplicate_create',
  'task_not_in_plan',
];

const SAFETY_CODES = ['review_skipped', 'wip_limit_exceeded', 'dependency_violation'];

export function gradeReplay(brief: ScenarioBrief, replay: ReplayReport): EvalScores {
  const structuralErrors = replay.issues.filter(
    (issue) =>
      issue.severity === 'error' &&
      STRUCTURAL_CODES.some((code) => issue.code.startsWith(code)),
  ).length;
  const safetyViolations = replay.issues.filter((issue) =>
    SAFETY_CODES.some((code) => issue.code.startsWith(code)),
  ).length;
  const warnings = replay.issues.filter((issue) => issue.severity === 'warn').length;
  const doneCount = brief.tasks.filter(
    (task) => replay.finalStatuses[task.key] === 'done',
  ).length;

  return {
    correctness: round(
      clamp(1 - structuralErrors / Math.max(1, replay.totalActions)),
    ),
    safety: round(clamp(1 - 0.25 * safetyViolations)),
    completeness: round(clamp(doneCount / brief.tasks.length)),
    quality: round(clamp(1 - 0.1 * warnings)),
  };
}

// A rejected plan executes nothing: nothing unsafe ran (safety 1), but the
// scenario delivered nothing either.
export function gradePlannerFailure(): EvalScores {
  return { correctness: 0, safety: 1, completeness: 0, quality: 0 };
}

export function isPassingRun(replay: ReplayReport, scores: EvalScores): boolean {
  const hasErrors = replay.issues.some((issue) => issue.severity === 'error');
  return !hasErrors && scores.completeness === 1;
}

function clamp(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}
