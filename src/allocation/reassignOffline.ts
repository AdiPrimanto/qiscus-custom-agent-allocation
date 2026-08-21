import { prisma } from '../db/prisma';
import { getAvailableAgents } from '../qiscus/client';

// Long enough that a brief disconnect (flaky wifi, a page reload) doesn't
// yank a chat away from an agent mid-conversation, and comfortably above the
// scheduler's own polling interval (10s) so this is a real debounce window
// rather than "reassign on the next tick"; short enough that a genuinely
// offline agent's rooms don't sit stuck for long.
const OFFLINE_GRACE_PERIOD_MS = 45 * 1000;

// Sweeps agents currently holding an `assigned` room and checks whether
// Qiscus still considers them online. There's no "list all agents" endpoint
// we have access to, so each agent's own `is_available` is read via the same
// available_agents call pickAgent already uses — scoped to one of their own
// assigned rooms, which they're guaranteed to be an eligible candidate for.
export async function reassignRoomsFromOfflineAgents(): Promise<number> {
  const agentsWithAssignedRooms = await prisma.agent.findMany({
    where: { assignments: { some: { status: 'assigned' } } },
    include: {
      assignments: {
        where: { status: 'assigned' },
        orderBy: { assignedAt: 'asc' },
        take: 1,
      },
    },
  });

  let reassignedCount = 0;

  for (const agent of agentsWithAssignedRooms) {
    const probeRoomId = agent.assignments[0]?.roomId;
    if (!probeRoomId) {
      continue;
    }

    let isOnline: boolean;
    try {
      const candidates = await getAvailableAgents(probeRoomId);
      const seen = candidates.find((candidate) => candidate.id === agent.qiscusAgentId);
      // Not showing up in this room's candidate list at all is treated the
      // same as offline — we can't confirm they're reachable.
      isOnline = seen?.is_available ?? false;
    } catch (error) {
      console.error(`reassignOffline: failed to check status for agent ${agent.id}`, error);
      continue;
    }

    if (isOnline) {
      if (agent.offlineSince) {
        await prisma.agent.update({ where: { id: agent.id }, data: { offlineSince: null } });
      }
      continue;
    }

    if (!agent.offlineSince) {
      await prisma.agent.update({ where: { id: agent.id }, data: { offlineSince: new Date() } });
      continue;
    }

    const offlineDurationMs = Date.now() - agent.offlineSince.getTime();
    if (offlineDurationMs < OFFLINE_GRACE_PERIOD_MS) {
      continue;
    }

    const result = await prisma.assignment.updateMany({
      where: { agentId: agent.id, status: 'assigned' },
      data: { agentId: null, status: 'waiting' },
    });
    reassignedCount += result.count;
    console.log(
      `reassignOffline: agent ${agent.id} offline for ${Math.round(offlineDurationMs / 1000)}s, requeued ${result.count} room(s)`,
    );
  }

  return reassignedCount;
}
