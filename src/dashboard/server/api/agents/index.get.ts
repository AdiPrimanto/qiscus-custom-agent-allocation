import { prisma } from '../../utils/prisma';
import { OFFLINE_GRACE_PERIOD_MS } from '../../utils/constants';

// "online" can't be asserted honestly from local data alone: offlineSince is
// only ever set for an agent currently holding an assigned room (see
// reassignRoomsFromOfflineAgents) — an idle agent with zero load is never
// probed against Qiscus, so its offlineSince staying null does not mean
// they're online. Report the two states we can actually back with data.
type AgentStatus = 'offline' | 'active';

export default defineEventHandler(async (event) => {
  const { maxConcurrentDefault } = useRuntimeConfig(event);

  const agents = await prisma.agent.findMany({
    orderBy: { name: 'asc' },
    include: {
      _count: { select: { assignments: { where: { status: 'assigned' } } } },
    },
  });

  return agents.map((agent) => {
    const offlineDurationMs = agent.offlineSince ? Date.now() - agent.offlineSince.getTime() : null;
    const status: AgentStatus = agent.offlineSince ? 'offline' : 'active';

    return {
      id: agent.id,
      qiscusAgentId: agent.qiscusAgentId,
      name: agent.name,
      email: agent.email,
      maxConcurrent: agent.maxConcurrent,
      // Heuristic, not tracked state: we don't record whether a value was
      // ever manually changed, just whether it currently matches the
      // service's default. A deliberate override that happens to equal the
      // default reads as "Default" here — acceptable for a display label.
      source: agent.maxConcurrent === maxConcurrentDefault ? 'default' : 'override',
      currentLoad: agent._count.assignments,
      status,
      offlineDurationMs,
      graceExpired: offlineDurationMs !== null ? offlineDurationMs >= OFFLINE_GRACE_PERIOD_MS : false,
    };
  });
});
