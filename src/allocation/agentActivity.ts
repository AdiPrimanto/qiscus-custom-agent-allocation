import { prisma } from '../db/prisma';

export async function updateAgentQuota(agentId: number, maxConcurrent: number, changedBy: string | null) {
  return prisma.$transaction(async (tx) => {
    const before = await tx.agent.findUniqueOrThrow({ where: { id: agentId } });
    const agent = await tx.agent.update({ where: { id: agentId }, data: { maxConcurrent } });

    if (before.maxConcurrent !== maxConcurrent) {
      await tx.agentActivityLog.create({
        data: { agentId, type: 'quota_change', oldValue: before.maxConcurrent, newValue: maxConcurrent, changedBy },
      });
    }

    return agent;
  });
}

export function recordAgentOffline(agentId: number) {
  return prisma.agentActivityLog.create({ data: { agentId, type: 'offline' } });
}

export function recordAgentOnline(agentId: number) {
  return prisma.agentActivityLog.create({ data: { agentId, type: 'online' } });
}

export async function listAgentActivity(limit = 100) {
  const logs = await prisma.agentActivityLog.findMany({
    orderBy: { occurredAt: 'desc' },
    take: limit,
    include: { agent: { select: { name: true } } },
  });

  return logs.map(({ agent, ...log }) => ({ ...log, agentName: agent.name }));
}
