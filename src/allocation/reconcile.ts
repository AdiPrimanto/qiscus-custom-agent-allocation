import { prisma } from '../db/prisma';
import { tryAssignWaiting } from './allocate';

export async function reconcileWaitingAssignments(): Promise<number> {
  const waiting = await prisma.assignment.findMany({
    where: { status: 'waiting' },
    orderBy: { createdAt: 'asc' },
  });

  let assignedCount = 0;
  for (const assignment of waiting) {
    const result = await tryAssignWaiting(assignment);
    if (result.status === 'assigned') {
      assignedCount += 1;
    }
  }

  return assignedCount;
}
