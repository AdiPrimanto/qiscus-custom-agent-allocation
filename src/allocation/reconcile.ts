import axios from 'axios';
import { prisma } from '../db/prisma';
import { tryAssignWaiting } from './allocate';
import { describeApiError } from '../qiscus/errors';

// A 4xx means Qiscus explicitly rejected this exact room (e.g. it's already
// resolved on their side) — retrying an identical request it already refused
// is pure waste. A room with no recorded error, no matter how long it's been
// waiting, is plain capacity backlog (pickAgent found nobody eligible, which
// isn't an error at all) and must keep being retried every cycle — giving up
// on those would silently strand real customers once an agent frees up.
function isPermanentlyRejected(assignment: { lastAssignErrorStatus: number | null }): boolean {
  const status = assignment.lastAssignErrorStatus;
  return status !== null && status >= 400 && status < 500;
}

export async function reconcileWaitingAssignments(): Promise<number> {
  const waiting = await prisma.assignment.findMany({
    where: { status: 'waiting' },
    orderBy: { createdAt: 'asc' },
  });

  let assignedCount = 0;
  for (const assignment of waiting) {
    if (isPermanentlyRejected(assignment)) {
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

      const status = axios.isAxiosError(error) ? (error.response?.status ?? null) : null;
      await prisma.assignment
        .update({
          where: { id: assignment.id },
          data: { lastAssignErrorAt: new Date(), lastAssignErrorStatus: status },
        })
        .catch((updateError) => {
          console.error('reconcile: failed to record assign error on room', { roomId: assignment.roomId, error: describeApiError(updateError) });
        });
    }
  }

  return assignedCount;
}
