import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runOfflineEvalSuite } from '../src/harness/offline-eval';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const outputPath = process.argv[2]
  ? resolve(repoRoot, process.argv[2])
  : join(repoRoot, 'docs', 'benchmark', 'offline-eval-summary.json');

const summary = runOfflineEvalSuite();
mkdirSync(dirname(outputPath), { recursive: true });
writeFileSync(outputPath, `${JSON.stringify(summary, null, 2)}\n`);

console.log(
  JSON.stringify(
    {
      suite: summary.suite,
      passed: summary.passed,
      total: summary.total,
      failed: summary.failed,
      wrote: outputPath,
    },
    null,
    2,
  ),
);

if (!summary.passed) {
  process.exit(1);
}
