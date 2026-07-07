import { describe, expect, it } from 'vitest';
import {
  TASK_STATUSES,
  TASK_STATUS_FLOW,
  isLegalTransition,
  isTerminal,
} from '../src/domain/state-machine';

describe('state machine', () => {
  it('mirrors the Rust TaskStatus enum wire format exactly', () => {
    expect(TASK_STATUSES).toEqual([
      'todo',
      'inprogress',
      'inreview',
      'done',
      'cancelled',
    ]);
  });

  it('allows the canonical forward flow', () => {
    expect(isLegalTransition('todo', 'inprogress')).toBe(true);
    expect(isLegalTransition('inprogress', 'inreview')).toBe(true);
    expect(isLegalTransition('inreview', 'done')).toBe(true);
  });

  it('allows structural fast-track and rework', () => {
    expect(isLegalTransition('inprogress', 'done')).toBe(true);
    expect(isLegalTransition('inreview', 'inprogress')).toBe(true);
  });

  it('allows cancellation from any non-terminal status', () => {
    expect(isLegalTransition('todo', 'cancelled')).toBe(true);
    expect(isLegalTransition('inprogress', 'cancelled')).toBe(true);
    expect(isLegalTransition('inreview', 'cancelled')).toBe(true);
  });

  it('rejects skipping states', () => {
    expect(isLegalTransition('todo', 'done')).toBe(false);
    expect(isLegalTransition('todo', 'inreview')).toBe(false);
  });

  it('makes done and cancelled terminal', () => {
    expect(TASK_STATUS_FLOW.done).toEqual([]);
    expect(TASK_STATUS_FLOW.cancelled).toEqual([]);
    expect(isTerminal('done')).toBe(true);
    expect(isTerminal('cancelled')).toBe(true);
    expect(isTerminal('todo')).toBe(false);
  });
});
