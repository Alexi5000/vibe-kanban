import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { buildContractArtifacts } from '../src/contracts/artifacts';
import { CONTRACT_VERSION } from '../src/contracts/sprint';

describe('contract artifacts', () => {
  it('builds deterministically', () => {
    const first = buildContractArtifacts();
    const second = buildContractArtifacts();
    expect(first.serialized).toBe(second.serialized);
    expect(first.hash).toBe(second.hash);
  });

  it('hashes the serialized document', () => {
    const artifacts = buildContractArtifacts();
    const recomputed = createHash('sha256')
      .update(artifacts.serialized)
      .digest('hex');
    expect(artifacts.hash).toBe(recomputed);
  });

  it('versions the contract and lists schemas alphabetically', () => {
    const artifacts = buildContractArtifacts();
    expect(artifacts.document.version).toBe(CONTRACT_VERSION);
    const names = Object.keys(artifacts.document.schemas);
    expect(names).toEqual([...names].sort());
    expect(names).toContain('sprintPlan');
    expect(names).toContain('taskStatus');
    expect(names).toContain('boardAction');
  });

  it('pins the task status enum to the Rust wire format', () => {
    const artifacts = buildContractArtifacts();
    const taskStatus = artifacts.document.schemas.taskStatus as {
      enum?: string[];
    };
    expect(taskStatus.enum).toEqual([
      'todo',
      'inprogress',
      'inreview',
      'done',
      'cancelled',
    ]);
  });
});
