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

// The lock wait is spent *inside* the transaction (it's the first statement
// after BEGIN), so it counts against Prisma's `timeout`. Under a burst, a
// request queued behind ~15+ others waiting on the same lock can blow past a
// tight timeout before it ever gets to do its own work — 30s/10s gives real
// headroom for bursts the size that caused the original bug (~20 rooms).
const TRANSACTION_OPTIONS = { timeout: 30000, maxWait: 10000 };

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

async function ensureWaitingAssignment(roomId: string, customerName?: string): Promise<Assignment> {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(${ALLOCATION_LOCK_KEY})`;

    const existing = await tx.assignment.findFirst({
      where: { roomId, status: { in: ['waiting', 'assigned'] } },
    });
    if (existing) {
      return existing;
    }

    return tx.assignment.create({ data: { roomId, status: 'waiting', customerName } });
  }, TRANSACTION_OPTIONS);
}

// Shared by tryAssign (a brand-new room) and tryAssignWaiting (reconcile
// retrying an existing one). Always re-reads the row inside the lock instead
// of trusting the caller's snapshot, because that snapshot can be stale by
// the time this transaction gets its turn (see tryAssignWaiting's caller).
async function attemptAllocation(
  tx: Prisma.TransactionClient,
  assignment: Assignment,
  options: { enforceFifo: boolean },
): Promise<Assignment> {
  const fresh = await tx.assignment.findUnique({ where: { id: assignment.id } });
  if (!fresh || fresh.status !== 'waiting') {
    return fresh ?? assignment;
  }

  if (options.enforceFifo) {
    const olderWaiting = await tx.assignment.findFirst({
      where: { status: 'waiting', createdAt: { lt: fresh.createdAt } },
    });
    if (olderWaiting) {
      return fresh;
    }
  }

  const chosen = await pickAgent(tx, fresh.roomId);
  if (!chosen) {
    return fresh;
  }

  return commitAssignment(tx, fresh, chosen);
}

export async function tryAssign(roomId: string, customerName?: string): Promise<Assignment> {
  // Split into two transactions on purpose: creating the 'waiting' row should
  // almost never fail, and keeping it in its own short transaction means a
  // failure in the allocation attempt below (pickAgent/commitAssignment call
  // out to Qiscus) can no longer roll back the room's very existence in our
  // DB. Worst case now is it stays 'waiting' and gets retried by reconcile,
  // instead of vanishing without a trace.
  const assignment = await ensureWaitingAssignment(roomId, customerName);

  if (assignment.status === 'assigned') {
    return assignment;
  }

  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(${ALLOCATION_LOCK_KEY})`;
    return attemptAllocation(tx, assignment, { enforceFifo: true });
  }, TRANSACTION_OPTIONS);
}

export async function tryAssignWaiting(assignment: Assignment): Promise<Assignment> {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(${ALLOCATION_LOCK_KEY})`;
    return attemptAllocation(tx, assignment, { enforceFifo: false });
  }, TRANSACTION_OPTIONS);
}
