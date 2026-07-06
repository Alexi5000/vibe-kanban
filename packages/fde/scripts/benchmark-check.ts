import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { EvalScores } from '../src/contracts/sprint';
import { runOfflineEvalSuite } from '../src/harness/offline-eval';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const summaryPath = join(repoRoot, 'docs', 'benchmark', 'offline-eval-summary.json');
const benchmarkPath = join(repoRoot, 'docs', 'BENCHMARK.md');

if (!existsSync(summaryPath)) {
  throw new Error('Benchmark summary is missing. Run pnpm run fde:evals.');
}
if (!existsSync(benchmarkPath)) {
  throw new Error('docs/BENCHMARK.md is missing.');
}

const expectedSummary = `${JSON.stringify(runOfflineEvalSuite(), null, 2)}\n`;
const committedSummary = readFileSync(summaryPath, 'utf8');
if (committedSummary !== expectedSummary) {
  throw new Error('Benchmark summary drift detected. Run pnpm run fde:evals.');
}

const parsed = JSON.parse(committedSummary) as {
  results: Array<{
    id: string;
    expectedPass: boolean;
    observedPass: boolean;
    scores: EvalScores;
  }>;
};
const benchmark = readFileSync(benchmarkPath, 'utf8');
const rowErrors: string[] = [];

for (const result of parsed.results) {
  const row = benchmark
    .split(/\r?\n/)
    .find((line) => line.startsWith(`| \`${result.id}\``));
  if (!row) {
    rowErrors.push(`missing row for ${result.id}`);
    continue;
  }
  const requiredSnippets = [
    result.expectedPass ? 'Pass' : 'Fail',
    result.observedPass ? 'Pass' : 'Fail',
    formatScores(result.scores),
  ];
  for (const snippet of requiredSnippets) {
    if (!row.includes(snippet)) {
      rowErrors.push(`${result.id} row is missing: ${snippet}`);
    }
  }
}

if (rowErrors.length) {
  throw new Error(
    `docs/BENCHMARK.md drift detected: ${rowErrors.join('; ')}`,
  );
}

console.log(
  JSON.stringify(
    {
      status: 'ok',
      checked: ['docs/benchmark/offline-eval-summary.json', 'docs/BENCHMARK.md'],
      scenarios: parsed.results.length,
    },
    null,
    2,
  ),
);

function formatScores(scores: EvalScores): string {
  return `C ${scores.correctness.toFixed(2)} / S ${scores.safety.toFixed(2)} / Comp ${scores.completeness.toFixed(2)} / Q ${scores.quality.toFixed(2)}`;
}
