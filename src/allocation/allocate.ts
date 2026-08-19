import type { Assignment } from '@prisma/client';
import { prisma } from '../db/prisma';
import { assignAgent, getAvailableAgents } from '../qiscus/client';
import { getOrCreateLocalAgent } from './agents';
import type { AvailableAgent } from '../qiscus/types';

async function pickAgent(roomId: string): Promise<AvailableAgent | null> {
  const candidates = await getAvailableAgents(roomId);
  const online = candidates.filter((agent) => agent.is_available);

  let best: AvailableAgent | null = null;

  for (const agent of online) {
    const local = await getOrCreateLocalAgent(agent);
    if (agent.current_customer_count >= local.maxConcurrent) {
      continue;
    }
    if (!best || agent.current_customer_count < best.current_customer_count) {
      best = agent;
    }
  }

  return best;
}

async function commitAssignment(assignment: Assignment, chosen: AvailableAgent): Promise<Assignment> {
  const localAgent = await getOrCreateLocalAgent(chosen);
  await assignAgent(assignment.roomId, chosen.id);

  return prisma.assignment.update({
    where: { id: assignment.id },
    data: { agentId: localAgent.id, status: 'assigned', assignedAt: new Date() },
  });
}

export async function tryAssign(roomId: string, customerIdentifier: string): Promise<Assignment> {
  let assignment = await prisma.assignment.findFirst({
    where: { roomId, status: { in: ['waiting', 'assigned'] } },
  });

  if (!assignment) {
    assignment = await prisma.assignment.create({
      data: { roomId, customerIdentifier, status: 'waiting' },
    });
  }

  if (assignment.status === 'assigned') {
    return assignment;
  }

  const chosen = await pickAgent(roomId);
  if (!chosen) {
    return assignment;
  }

  return commitAssignment(assignment, chosen);
}

export async function tryAssignWaiting(assignment: Assignment): Promise<Assignment> {
  const chosen = await pickAgent(assignment.roomId);
  if (!chosen) {
    return assignment;
  }

  return commitAssignment(assignment, chosen);
}
