import { prisma } from '../db/prisma';
import { tryAssignWaiting } from './allocate';
import { describeApiError } from '../qiscus/errors';

// A room this old has already been retried on every reconcile cycle since it
// started waiting — if an hour of that hasn't found it a slot, more retries
// aren't likely to either (and if Qiscus is rejecting it outright, e.g. a
// stale/invalid room, retrying is pure waste). Stop spending API calls on it;
// the dashboard's own "waiting too long" alert (2 min threshold) already
// flags it for a human well before this kicks in.
const GIVE_UP_AFTER_MS = 60 * 60 * 1000;

export async function reconcileWaitingAssignments(): Promise<number> {
  const waiting = await prisma.assignment.findMany({
    where: { status: 'waiting' },
    orderBy: { createdAt: 'asc' },
  });

  let assignedCount = 0;
  for (const assignment of waiting) {
    if (Date.now() - assignment.createdAt.getTime() > GIVE_UP_AFTER_MS) {
      continue;
    }
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
