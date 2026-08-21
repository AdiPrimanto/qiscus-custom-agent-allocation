import { prisma } from '../db/prisma';
import { tryAssignWaiting } from './allocate';
import { describeApiError } from '../qiscus/errors';

export async function reconcileWaitingAssignments(): Promise<number> {
  const waiting = await prisma.assignment.findMany({
    where: { status: 'waiting' },
    orderBy: { createdAt: 'asc' },
  });

  let assignedCount = 0;
  for (const assignment of waiting) {
    try {
      const result = await tryAssignWaiting(assignment);
      if (result.status === 'assigned') {
        assignedCount += 1;
      }
    } catch (error) {
      // One room failing (timed-out transaction, Qiscus API hiccup, ...) should
      // not stop the rest of the batch from being reconciled — it stays
      // 'waiting' and gets retried on the next reconcile cycle.
      console.error('reconcile: failed to assign a waiting room', { roomId: assignment.roomId, error: describeApiError(error) });
    }
  }

  return assignedCount;
}
