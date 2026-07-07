import { z } from 'zod';

export const CONTRACT_VERSION = 1;

// Mirrors TaskStatus in crates/db/src/models/task.rs (serde rename_all = "lowercase").
export const TaskStatusSchema = z.enum([
  'todo',
  'inprogress',
  'inreview',
  'done',
  'cancelled',
]);
export type TaskStatus = z.infer<typeof TaskStatusSchema>;

export const TaskKeySchema = z
  .string()
  .regex(/^[a-z][a-z0-9-]*$/)
  .min(1)
  .max(64);

export const ScenarioTaskSchema = z.strictObject({
  key: TaskKeySchema,
  title: z.string().min(1),
  agent: z.string().min(1),
  dependsOn: z.array(TaskKeySchema).default([]),
});
export type ScenarioTask = z.infer<typeof ScenarioTaskSchema>;

export const ScenarioConstraintsSchema = z.strictObject({
  maxWipPerAgent: z.number().int().min(1).default(1),
  requireReview: z.boolean().default(true),
});
export type ScenarioConstraints = z.infer<typeof ScenarioConstraintsSchema>;

export const ScenarioBriefSchema = z.strictObject({
  id: z.string().min(1),
  title: z.string().min(1),
  objective: z.string().min(1),
  tasks: z.array(ScenarioTaskSchema).min(1),
  constraints: ScenarioConstraintsSchema,
});
export type ScenarioBrief = z.infer<typeof ScenarioBriefSchema>;

export const SprintPlanSchema = z.strictObject({
  contractVersion: z.literal(CONTRACT_VERSION),
  scenarioId: z.string().min(1),
  orderedTaskKeys: z.array(TaskKeySchema).min(1),
  assignments: z.record(TaskKeySchema, z.string().min(1)),
  maxWipPerAgent: z.number().int().min(1),
  requireReview: z.boolean(),
});
export type SprintPlan = z.infer<typeof SprintPlanSchema>;

export const BoardActionSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('create_task'),
    taskKey: TaskKeySchema,
    actor: z.string().min(1),
  }),
  z.strictObject({
    kind: z.literal('set_status'),
    taskKey: TaskKeySchema,
    actor: z.string().min(1),
    from: TaskStatusSchema,
    to: TaskStatusSchema,
  }),
]);
export type BoardAction = z.infer<typeof BoardActionSchema>;

export const EvalScoresSchema = z.strictObject({
  correctness: z.number().min(0).max(1),
  safety: z.number().min(0).max(1),
  completeness: z.number().min(0).max(1),
  quality: z.number().min(0).max(1),
});
export type EvalScores = z.infer<typeof EvalScoresSchema>;

export const EvalResultSchema = z.strictObject({
  id: z.string().min(1),
  expectedPass: z.boolean(),
  observedPass: z.boolean(),
  passed: z.boolean(),
  scores: EvalScoresSchema,
  issues: z.array(z.string()),
});
export type EvalResult = z.infer<typeof EvalResultSchema>;

export const EvalSuiteSummarySchema = z.strictObject({
  contractVersion: z.literal(CONTRACT_VERSION),
  suite: z.string().min(1),
  generatedAt: z.literal('deterministic'),
  passed: z.boolean(),
  total: z.number().int().min(0),
  failed: z.number().int().min(0),
  results: z.array(EvalResultSchema),
});
export type EvalSuiteSummary = z.infer<typeof EvalSuiteSummarySchema>;
