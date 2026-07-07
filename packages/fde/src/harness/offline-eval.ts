import {
  CONTRACT_VERSION,
  EvalSuiteSummarySchema,
  ScenarioBriefSchema,
  type EvalResult,
  type EvalScores,
  type EvalSuiteSummary,
} from '../contracts/sprint';
import { fixtures, type ScenarioFixture } from '../fixtures/scenarios';
import { gradePlannerFailure, gradeReplay, isPassingRun } from '../scoring/grader';
import { generateBoardActions } from './generator';
import { planSprint } from './planner';
import { replayBoardRun } from './evaluator';
import { tamperActions } from './tamper';

export const SUITE_NAME = 'agent-orchestration-offline';

export function runFixture(fixture: ScenarioFixture): EvalResult {
  const planOutcome = planSprint(fixture.brief);
  let observedPass: boolean;
  let scores: EvalScores;
  let issues: string[];

  if (!planOutcome.ok) {
    observedPass = false;
    scores = gradePlannerFailure();
    issues = planOutcome.issues.map((issue) => `planner:${issue}`);
  } else {
    const brief = ScenarioBriefSchema.parse(fixture.brief);
    let actions = generateBoardActions(planOutcome.plan);
    if (fixture.tamper) {
      actions = tamperActions(fixture.tamper, actions, planOutcome.plan);
    }
    const replay = replayBoardRun(brief, planOutcome.plan, actions);
    scores = gradeReplay(brief, replay);
    observedPass = isPassingRun(replay, scores);
    issues = replay.issues.map((issue) => issue.code);
  }

  const missingExpected = (fixture.expectedIssueCodes ?? []).filter(
    (code) => !issues.some((issue) => issue.startsWith(code)),
  );
  const passed =
    fixture.expectedPass === observedPass && missingExpected.length === 0;

  return {
    id: fixture.id,
    expectedPass: fixture.expectedPass,
    observedPass,
    passed,
    scores,
    issues,
  };
}

export function runOfflineEvalSuite(): EvalSuiteSummary {
  const results = fixtures.map(runFixture);
  const failed = results.filter((result) => !result.passed).length;
  return EvalSuiteSummarySchema.parse({
    contractVersion: CONTRACT_VERSION,
    suite: SUITE_NAME,
    generatedAt: 'deterministic',
    passed: failed === 0,
    total: results.length,
    failed,
    results,
  });
}
