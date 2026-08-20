import type { Assignment, Prisma } from '@prisma/client';
import { prisma } from '../db/prisma';
import { assignAgent, getAvailableAgents } from '../qiscus/client';
import { getOrCreateLocalAgent } from './agents';
import type { AvailableAgent } from '../qiscus/types';

// Serializes every allocation decision across concurrent requests. Without this,
// two rooms arriving at the same time can both read the same (stale) capacity
// snapshot and both get assigned to the same agent, blowing past max_concurrent.
// Arbitrary fixed key — same key on every call is what makes callers queue up
// behind each other instead of running the check-then-write race in parallel.
const ALLOCATION_LOCK_KEY = 872_364_501;

async function pickAgent(tx: Prisma.TransactionClient, roomId: string): Promise<AvailableAgent | null> {
  const candidates = await getAvailableAgents(roomId);
  const online = candidates.filter((agent) => agent.is_available);

  let best: AvailableAgent | null = null;

  for (const agent of online) {
    const local = await getOrCreateLocalAgent(tx, agent);
    const localActiveCount = await tx.assignment.count({
      where: { agentId: local.id, status: 'assigned' },
    });
    // Qiscus's current_customer_count can lag behind an assignment we just
    // committed in this same burst (it only updates after assign_agent
    // finishes), or it can know about load this service never tracked
    // locally (chats assigned outside this service). Taking the higher of
    // the two means neither a stale Qiscus snapshot nor a fresh local write
    // alone can be used to sneak past the cap.
    const effectiveCount = Math.max(localActiveCount, agent.current_customer_count);
    if (effectiveCount >= local.maxConcurrent) {
      continue;
    }
    if (!best || agent.current_customer_count < best.current_customer_count) {
      best = agent;
    }
  }

  return best;
}

async function commitAssignment(
  tx: Prisma.TransactionClient,
  assignment: Assignment,
  chosen: AvailableAgent,
): Promise<Assignment> {
  const localAgent = await getOrCreateLocalAgent(tx, chosen);
  await assignAgent(assignment.roomId, chosen.id);

  return tx.assignment.update({
    where: { id: assignment.id },
    data: { agentId: localAgent.id, status: 'assigned', assignedAt: new Date() },
  });
}

export async function tryAssign(roomId: string, customerIdentifier: string): Promise<Assignment> {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(${ALLOCATION_LOCK_KEY})`;

    let assignment = await tx.assignment.findFirst({
      where: { roomId, status: { in: ['waiting', 'assigned'] } },
    });

    if (!assignment) {
      assignment = await tx.assignment.create({
        data: { roomId, customerIdentifier, status: 'waiting' },
      });
    }

    if (assignment.status === 'assigned') {
      return assignment;
    }

    const olderWaiting = await tx.assignment.findFirst({
      where: { status: 'waiting', createdAt: { lt: assignment.createdAt } },
    });
    if (olderWaiting) {
      return assignment;
    }

    const chosen = await pickAgent(tx, roomId);
    if (!chosen) {
      return assignment;
    }

    return commitAssignment(tx, assignment, chosen);
  }, { timeout: 15000 });
}

export async function tryAssignWaiting(assignment: Assignment): Promise<Assignment> {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(${ALLOCATION_LOCK_KEY})`;

    const chosen = await pickAgent(tx, assignment.roomId);
    if (!chosen) {
      return assignment;
    }

    return commitAssignment(tx, assignment, chosen);
  }, { timeout: 15000 });
}
