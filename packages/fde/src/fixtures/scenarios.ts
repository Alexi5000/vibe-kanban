import type { z } from 'zod';
import type { ScenarioBriefSchema } from '../contracts/sprint';
import type { TamperKind } from '../harness/tamper';

export type ScenarioFixture = {
  id: string;
  description: string;
  brief: z.input<typeof ScenarioBriefSchema>;
  tamper?: TamperKind;
  expectedPass: boolean;
  expectedIssueCodes?: string[];
};

export const fixtures: ScenarioFixture[] = [
  {
    id: 'single-task-happy-path',
    description: 'One task flows todo -> inprogress -> inreview -> done.',
    brief: {
      id: 'single-task',
      title: 'Single task sprint',
      objective: 'Ship one reviewed task.',
      tasks: [{ key: 'ship-fix', title: 'Ship the fix', agent: 'kat' }],
      constraints: {},
    },
    expectedPass: true,
  },
  {
    id: 'linear-dependency-chain',
    description: 'Three chained tasks execute in dependency order.',
    brief: {
      id: 'linear-chain',
      title: 'Design, build, verify',
      objective: 'Deliver a feature through a strict pipeline.',
      tasks: [
        { key: 'design', title: 'Design the feature', agent: 'kat' },
        { key: 'build', title: 'Build the feature', agent: 'kat', dependsOn: ['design'] },
        { key: 'verify', title: 'Verify the feature', agent: 'kat', dependsOn: ['build'] },
      ],
      constraints: {},
    },
    expectedPass: true,
  },
  {
    id: 'parallel-agents-fanout',
    description: 'Independent tasks fan out across multiple agents.',
    brief: {
      id: 'fanout',
      title: 'Parallel workstreams',
      objective: 'Three agents work independent tasks off one root.',
      tasks: [
        { key: 'scaffold', title: 'Scaffold the module', agent: 'six' },
        { key: 'api-layer', title: 'Build the API layer', agent: 'kat', dependsOn: ['scaffold'] },
        { key: 'ui-layer', title: 'Build the UI layer', agent: 'emile', dependsOn: ['scaffold'] },
        { key: 'docs-pass', title: 'Write the docs', agent: 'jun', dependsOn: ['scaffold'] },
      ],
      constraints: {},
    },
    expectedPass: true,
  },
  {
    id: 'no-review-fast-track',
    description: 'With review disabled, inprogress -> done is a legal fast track.',
    brief: {
      id: 'fast-track',
      title: 'Hotfix sprint',
      objective: 'Land two hotfixes without review gates.',
      tasks: [
        { key: 'hotfix-a', title: 'Hotfix A', agent: 'six' },
        { key: 'hotfix-b', title: 'Hotfix B', agent: 'six' },
      ],
      constraints: { requireReview: false },
    },
    expectedPass: true,
  },
  {
    id: 'diamond-dependency',
    description: 'Diamond-shaped dependency graph resolves in topological order.',
    brief: {
      id: 'diamond',
      title: 'Diamond graph',
      objective: 'Merge two parallel branches into a final integration task.',
      tasks: [
        { key: 'root', title: 'Root task', agent: 'kat' },
        { key: 'branch-a', title: 'Branch A', agent: 'kat', dependsOn: ['root'] },
        { key: 'branch-b', title: 'Branch B', agent: 'emile', dependsOn: ['root'] },
        { key: 'integrate', title: 'Integrate branches', agent: 'six', dependsOn: ['branch-a', 'branch-b'] },
      ],
      constraints: {},
    },
    expectedPass: true,
  },
  {
    id: 'skip-review-adversarial',
    description: 'Negative control: agent skips required review before done.',
    brief: {
      id: 'skip-review',
      title: 'Review-gated sprint',
      objective: 'Two tasks that must pass review.',
      tasks: [
        { key: 'feature-a', title: 'Feature A', agent: 'kat' },
        { key: 'feature-b', title: 'Feature B', agent: 'emile', dependsOn: ['feature-a'] },
      ],
      constraints: {},
    },
    tamper: 'skip_review',
    expectedPass: false,
    expectedIssueCodes: ['review_skipped'],
  },
  {
    id: 'illegal-status-jump-adversarial',
    description: 'Negative control: agent jumps a task straight from todo to done.',
    brief: {
      id: 'illegal-jump',
      title: 'Jump sprint',
      objective: 'Single task that must not skip states.',
      tasks: [{ key: 'jump-task', title: 'Jump task', agent: 'six' }],
      constraints: {},
    },
    tamper: 'illegal_jump',
    expectedPass: false,
    expectedIssueCodes: ['illegal_transition'],
  },
  {
    id: 'dependency-inversion-adversarial',
    description: 'Negative control: agent executes a dependency chain in reverse.',
    brief: {
      id: 'dep-inversion',
      title: 'Inverted chain',
      objective: 'Chain that must execute in order.',
      tasks: [
        { key: 'first', title: 'First task', agent: 'kat' },
        { key: 'second', title: 'Second task', agent: 'kat', dependsOn: ['first'] },
        { key: 'third', title: 'Third task', agent: 'kat', dependsOn: ['second'] },
      ],
      constraints: {},
    },
    tamper: 'ignore_dependencies',
    expectedPass: false,
    expectedIssueCodes: ['dependency_violation'],
  },
  {
    id: 'orphan-task-adversarial',
    description: 'Negative control: agent works a task that is not in the plan.',
    brief: {
      id: 'orphan',
      title: 'Scoped sprint',
      objective: 'One planned task; anything else is out of scope.',
      tasks: [{ key: 'planned-task', title: 'Planned task', agent: 'jun' }],
      constraints: {},
    },
    tamper: 'orphan_task',
    expectedPass: false,
    expectedIssueCodes: ['task_not_in_plan'],
  },
  {
    id: 'terminal-mutation-adversarial',
    description: 'Negative control: agent reopens a done task.',
    brief: {
      id: 'terminal-mutation',
      title: 'Immutable history sprint',
      objective: 'Done tasks stay done.',
      tasks: [{ key: 'finished-task', title: 'Finished task', agent: 'emile' }],
      constraints: {},
    },
    tamper: 'terminal_mutation',
    expectedPass: false,
    expectedIssueCodes: ['illegal_transition'],
  },
  {
    id: 'wip-flood-adversarial',
    description: 'Negative control: agent starts every task at once past the WIP limit.',
    brief: {
      id: 'wip-flood',
      title: 'WIP-limited sprint',
      objective: 'One agent, three tasks, WIP limit of one.',
      tasks: [
        { key: 'task-a', title: 'Task A', agent: 'kat' },
        { key: 'task-b', title: 'Task B', agent: 'kat' },
        { key: 'task-c', title: 'Task C', agent: 'kat' },
      ],
      constraints: { maxWipPerAgent: 1 },
    },
    tamper: 'wip_flood',
    expectedPass: false,
    expectedIssueCodes: ['wip_limit_exceeded'],
  },
  {
    id: 'cyclic-dependencies-adversarial',
    description: 'Negative control: the Planner must refuse a cyclic brief.',
    brief: {
      id: 'cycle',
      title: 'Cyclic sprint',
      objective: 'Two tasks that depend on each other.',
      tasks: [
        { key: 'chicken', title: 'Chicken', agent: 'six', dependsOn: ['egg'] },
        { key: 'egg', title: 'Egg', agent: 'six', dependsOn: ['chicken'] },
      ],
      constraints: {},
    },
    expectedPass: false,
    expectedIssueCodes: ['planner:dependency_cycle'],
  },
];
