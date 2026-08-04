import type { Execution } from '../types/execution.js';

export interface ScheduledItem {
  executionId: string;
  priority: number;
  submittedAt: number;
}

/** Schedules queued executions by priority (then FIFO by submission). */
export class PriorityScheduler {
  private readonly items: ScheduledItem[] = [];

  add(item: ScheduledItem): void {
    this.items.push(item);
    this.items.sort((a, b) => {
      if (b.priority !== a.priority) return b.priority - a.priority;
      return a.submittedAt - b.submittedAt;
    });
  }

  schedule(execution: Execution, submittedAt = Date.now()): void {
    this.add({ executionId: execution.id, priority: execution.steps.reduce((acc, step) => acc + step.priority, 0), submittedAt });
  }

  remove(executionId: string): boolean {
    const index = this.items.findIndex((item) => item.executionId === executionId);
    if (index === -1) return false;
    this.items.splice(index, 1);
    return true;
  }

  next(): ScheduledItem | null {
    return this.items.shift() ?? null;
  }

  peek(): ScheduledItem | null {
    return this.items[0] ?? null;
  }

  get size(): number {
    return this.items.length;
  }

  clear(): void {
    this.items.length = 0;
  }
}
