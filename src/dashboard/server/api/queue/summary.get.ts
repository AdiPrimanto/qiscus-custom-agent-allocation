import { prisma } from '../../utils/prisma';
import { OFFLINE_GRACE_PERIOD_MS, WAITING_STUCK_THRESHOLD_MS } from '../../utils/constants';

export default defineEventHandler(async () => {
  const [waitingRooms, statusCounts, agentTotals, stuckOfflineAgents] = await Promise.all([
    prisma.assignment.findMany({
      where: { status: 'waiting' },
      orderBy: { createdAt: 'asc' },
      take: 1,
      select: { roomId: true, createdAt: true },
    }),
    prisma.assignment.groupBy({ by: ['status'], _count: { status: true } }),
    prisma.agent.aggregate({ _sum: { maxConcurrent: true }, _count: true }),
    prisma.agent.findMany({
      where: { offlineSince: { not: null }, assignments: { some: { status: 'assigned' } } },
      select: { id: true, name: true, offlineSince: true },
    }),
  ]);

  const oldestWaiting = waitingRooms[0]?.createdAt ?? null;
  const oldestWaitingAgeMs = oldestWaiting ? Date.now() - oldestWaiting.getTime() : null;

  const countByStatus = Object.fromEntries(statusCounts.map((row: any) => [row.status, row._count.status]));

  const alerts: Array<{ type: 'waiting-stuck' | 'offline-reassign-pending'; message: string }> = [];

  if (oldestWaitingAgeMs !== null && oldestWaitingAgeMs >= WAITING_STUCK_THRESHOLD_MS) {
    const waitingCount = countByStatus.waiting ?? 0;
    const othersNote = waitingCount > 1 ? ` (dan ${waitingCount - 1} room lain nunggu)` : '';
    alerts.push({
      type: 'waiting-stuck',
      message: `Room ${waitingRooms[0].roomId} menunggu ${formatDuration(oldestWaitingAgeMs)}${othersNote} — belum ada agent yang kosong di bawah kuota.`,
    });
  }

  for (const agent of stuckOfflineAgents) {
    const offlineDurationMs = Date.now() - (agent.offlineSince as Date).getTime();
    alerts.push({
      type: 'offline-reassign-pending',
      message: `Agent ${agent.name} offline ${formatDuration(offlineDurationMs)}, masih pegang chat assigned — reassign ${
        offlineDurationMs >= OFFLINE_GRACE_PERIOD_MS ? 'akan jalan di reconcile berikutnya' : 'pending grace period'
      }.`,
    });
  }

  return {
    waitingCount: countByStatus.waiting ?? 0,
    assignedCount: countByStatus.assigned ?? 0,
    resolvedCount: countByStatus.resolved ?? 0,
    oldestWaitingAgeMs,
    totalAgents: agentTotals._count,
    totalCapacity: agentTotals._sum.maxConcurrent ?? 0,
    waitingStuckThresholdMs: WAITING_STUCK_THRESHOLD_MS,
    alerts,
  };
});
