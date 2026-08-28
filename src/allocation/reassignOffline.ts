import { prisma } from '../db/prisma';
import { getAllAgents } from '../qiscus/client';
import { describeApiError } from '../qiscus/errors';

// Long enough that a brief disconnect (flaky wifi, a page reload) doesn't
// yank a chat away from an agent mid-conversation, and comfortably above the
// scheduler's own polling interval (10s) so this is a real debounce window
// rather than "reassign on the next tick"; short enough that a genuinely
// offline agent's rooms don't sit stuck for long.
export const OFFLINE_GRACE_PERIOD_MS = 45 * 1000;

// Sweeps every locally-known agent — not just ones currently holding an
// assigned room. GET /api/v2/admin/agents is a single bulk call covering the
// whole app, unlike the old per-room available_agents probe, so this now
// also catches an agent idle with zero assigned rooms going offline (that
// case was structurally unreachable before: you can only probe an agent
// through a room they're an eligible candidate for).
export async function reassignRoomsFromOfflineAgents(): Promise<number> {
  const localAgents = await prisma.agent.findMany();
  if (localAgents.length === 0) {
    return 0;
  }

  let remoteAgents;
  try {
    remoteAgents = await getAllAgents();
  } catch (error) {
    console.error('reassignOffline: failed to fetch agent list', describeApiError(error));
    return 0;
  }
  const remoteById = new Map(remoteAgents.map((remote) => [remote.id, remote]));

  let reassignedCount = 0;

  for (const agent of localAgents) {
    // Not showing up in the remote list at all is treated the same as
    // offline — we can't confirm they're reachable.
    const isOnline = remoteById.get(agent.qiscusAgentId)?.is_available ?? false;

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
      // assignedAt must go back to null here too — every other 'waiting' row
      // has it unset (see ensureWaitingAssignment in allocate.ts), and
      // leaving a stale value would make a room this offline agent never
      // really finished look like it already has a wait time computed
      // against an assignment it no longer holds.
      // lastAssignError* reset too — a room re-entering the queue via a
      // different agent going offline deserves a fresh shot, not to inherit
      // an unrelated rejection from whatever it was doing before.
      data: { agentId: null, status: 'waiting', assignedAt: null, lastAssignErrorAt: null, lastAssignErrorStatus: null },
    });
    reassignedCount += result.count;
    if (result.count > 0) {
      console.log(
        `reassignOffline: agent ${agent.id} offline for ${Math.round(offlineDurationMs / 1000)}s, requeued ${result.count} room(s)`,
      );
    }
  }

  return reassignedCount;
}
