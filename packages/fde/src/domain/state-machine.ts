import type { TaskStatus } from '../contracts/sprint';

export const TASK_STATUSES: readonly TaskStatus[] = [
  'todo',
  'inprogress',
  'inreview',
  'done',
  'cancelled',
];

// Structural transitions of the board. inprogress -> done is structurally
// legal (the board allows the drag); whether it violates review policy is a
// contract-level decision made by the evaluator.
export const TASK_STATUS_FLOW: Record<TaskStatus, readonly TaskStatus[]> = {
  todo: ['inprogress', 'cancelled'],
  inprogress: ['inreview', 'done', 'cancelled'],
  inreview: ['done', 'inprogress', 'cancelled'],
  done: [],
  cancelled: [],
};

export const TERMINAL_STATUSES: readonly TaskStatus[] = ['done', 'cancelled'];

export function isLegalTransition(from: TaskStatus, to: TaskStatus): boolean {
  return TASK_STATUS_FLOW[from].includes(to);
}

export function isTerminal(status: TaskStatus): boolean {
  return TERMINAL_STATUSES.includes(status);
}
