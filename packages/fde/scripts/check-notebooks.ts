import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const notebooksDir = join(repoRoot, 'notebooks');

if (!existsSync(notebooksDir)) {
  throw new Error('notebooks/ directory is missing.');
}
if (!existsSync(join(notebooksDir, 'README.md'))) {
  throw new Error('notebooks/README.md is missing.');
}

const notebookFiles = readdirSync(notebooksDir).filter((name) =>
  name.endsWith('.ipynb'),
);
if (notebookFiles.length === 0) {
  throw new Error('notebooks/ contains no .ipynb files.');
}

type NotebookCell = {
  cell_type: string;
  outputs?: unknown[];
  execution_count?: number | null;
};

const errors: string[] = [];
for (const name of notebookFiles) {
  const raw = readFileSync(join(notebooksDir, name), 'utf8');
  let notebook: { nbformat?: number; cells?: NotebookCell[] };
  try {
    notebook = JSON.parse(raw);
  } catch {
    errors.push(`${name}: not valid JSON`);
    continue;
  }
  if (notebook.nbformat !== 4) {
    errors.push(`${name}: nbformat must be 4`);
  }
  const cells = notebook.cells ?? [];
  if (!cells.some((cell) => cell.cell_type === 'markdown')) {
    errors.push(`${name}: must contain at least one markdown cell`);
  }
  for (const [index, cell] of cells.entries()) {
    if (cell.cell_type !== 'code') continue;
    if ((cell.outputs ?? []).length > 0) {
      errors.push(`${name}: code cell ${index} has committed outputs (authoring surface must stay clean)`);
    }
    if (cell.execution_count != null) {
      errors.push(`${name}: code cell ${index} has an execution count`);
    }
  }
}

if (errors.length) {
  throw new Error(`Notebook check failed: ${errors.join('; ')}`);
}

console.log(
  JSON.stringify(
    { status: 'ok', notebooks: notebookFiles.sort() },
    null,
    2,
  ),
);
