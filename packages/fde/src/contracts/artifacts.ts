import { createHash } from 'node:crypto';
import { z } from 'zod';
import {
  BoardActionSchema,
  CONTRACT_VERSION,
  EvalResultSchema,
  EvalScoresSchema,
  EvalSuiteSummarySchema,
  ScenarioBriefSchema,
  ScenarioConstraintsSchema,
  ScenarioTaskSchema,
  SprintPlanSchema,
  TaskStatusSchema,
} from './sprint';

// Alphabetical ordering keeps the serialized artifact deterministic.
const contractSchemas = {
  boardAction: BoardActionSchema,
  evalResult: EvalResultSchema,
  evalScores: EvalScoresSchema,
  evalSuiteSummary: EvalSuiteSummarySchema,
  scenarioBrief: ScenarioBriefSchema,
  scenarioConstraints: ScenarioConstraintsSchema,
  scenarioTask: ScenarioTaskSchema,
  sprintPlan: SprintPlanSchema,
  taskStatus: TaskStatusSchema,
} as const;

export type ContractArtifacts = {
  document: {
    version: number;
    generatedAt: 'deterministic';
    schemas: Record<string, unknown>;
  };
  serialized: string;
  hash: string;
};

export function buildContractArtifacts(): ContractArtifacts {
  const schemas: Record<string, unknown> = {};
  for (const [name, schema] of Object.entries(contractSchemas)) {
    schemas[name] = z.toJSONSchema(schema);
  }
  const document = {
    version: CONTRACT_VERSION,
    generatedAt: 'deterministic' as const,
    schemas,
  };
  const serialized = `${JSON.stringify(document, null, 2)}\n`;
  const hash = createHash('sha256').update(serialized).digest('hex');
  return { document, serialized, hash };
}
