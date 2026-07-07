import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildContractArtifacts } from '../src/contracts/artifacts';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const contractsDir = join(repoRoot, 'contracts');
const artifacts = buildContractArtifacts();

mkdirSync(contractsDir, { recursive: true });
writeFileSync(join(contractsDir, 'schema.json'), artifacts.serialized);
writeFileSync(join(contractsDir, 'schema.sha256'), `${artifacts.hash}  schema.json\n`);

console.log(
  JSON.stringify(
    {
      status: 'ok',
      wrote: ['contracts/schema.json', 'contracts/schema.sha256'],
      hash: artifacts.hash,
    },
    null,
    2,
  ),
);
