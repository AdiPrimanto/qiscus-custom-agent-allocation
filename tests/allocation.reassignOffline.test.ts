// tests/allocation.reassignOffline.test.ts
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import nock from 'nock';
import { env } from '../src/config/env';
import { prisma } from '../src/db/prisma';
import { reassignRoomsFromOfflineAgents } from '../src/allocation/reassignOffline';

describe('reassignRoomsFromOfflineAgents', () => {
  afterEach(async () => {
    await prisma.assignment.deleteMany();
    await prisma.agent.deleteMany();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('marks an agent as offline on first sight, without touching their assigned rooms yet', async () => {
    const agent = await prisma.agent.create({
      data: { qiscusAgentId: 301, name: 'Dewi', email: 'dewi@mail.com', maxConcurrent: 2 },
    });
    await prisma.assignment.create({
      data: { roomId: 'room-a', agentId: agent.id, status: 'assigned', assignedAt: new Date() },
    });

    nock(env.qiscusBaseUrl)
      .get('/api/v2/admin/service/available_agents')
      .query({ room_id: 'room-a' })
      .reply(200, {
        data: {
          agents: [{ id: 301, name: 'Dewi', email: 'dewi@mail.com', type: 2, type_as_string: 'agent', is_available: false, current_customer_count: 1 }],
        },
      });

    const reassignedCount = await reassignRoomsFromOfflineAgents();

    expect(reassignedCount).toBe(0);
    const updatedAgent = await prisma.agent.findUnique({ where: { id: agent.id } });
    expect(updatedAgent?.offlineSince).not.toBeNull();
    const assignment = await prisma.assignment.findFirst({ where: { roomId: 'room-a' } });
    expect(assignment?.status).toBe('assigned');
    expect(assignment?.agentId).toBe(agent.id);
  });

  it('requeues an agent’s assigned rooms once they have been offline past the grace period', async () => {
    const twoAndAHalfMinutesAgo = new Date(Date.now() - 2.5 * 60 * 1000);
    const agent = await prisma.agent.create({
      data: { qiscusAgentId: 302, name: 'Budi', email: 'budi@mail.com', maxConcurrent: 2, offlineSince: twoAndAHalfMinutesAgo },
    });
    await prisma.assignment.create({
      data: { roomId: 'room-b', agentId: agent.id, status: 'assigned', assignedAt: new Date() },
    });

    nock(env.qiscusBaseUrl)
      .get('/api/v2/admin/service/available_agents')
      .query({ room_id: 'room-b' })
      .reply(200, {
        data: {
          agents: [{ id: 302, name: 'Budi', email: 'budi@mail.com', type: 2, type_as_string: 'agent', is_available: false, current_customer_count: 1 }],
        },
      });

    const reassignedCount = await reassignRoomsFromOfflineAgents();

    expect(reassignedCount).toBe(1);
    const assignment = await prisma.assignment.findFirst({ where: { roomId: 'room-b' } });
    expect(assignment?.status).toBe('waiting');
    expect(assignment?.agentId).toBeNull();
    // Every other 'waiting' row in the system has assignedAt: null (see
    // ensureWaitingAssignment) — a requeued room must match that invariant,
    // or anything computing wait time from assignedAt reads a stale value
    // from the assignment this room no longer has.
    expect(assignment?.assignedAt).toBeNull();
  });

  it('does not requeue an agent still within the grace period', async () => {
    const thirtySecondsAgo = new Date(Date.now() - 30 * 1000);
    const agent = await prisma.agent.create({
      data: { qiscusAgentId: 303, name: 'Citra', email: 'citra@mail.com', maxConcurrent: 2, offlineSince: thirtySecondsAgo },
    });
    await prisma.assignment.create({
      data: { roomId: 'room-c', agentId: agent.id, status: 'assigned', assignedAt: new Date() },
    });

    nock(env.qiscusBaseUrl)
      .get('/api/v2/admin/service/available_agents')
      .query({ room_id: 'room-c' })
      .reply(200, {
        data: {
          agents: [{ id: 303, name: 'Citra', email: 'citra@mail.com', type: 2, type_as_string: 'agent', is_available: false, current_customer_count: 1 }],
        },
      });

    const reassignedCount = await reassignRoomsFromOfflineAgents();

    expect(reassignedCount).toBe(0);
    const assignment = await prisma.assignment.findFirst({ where: { roomId: 'room-c' } });
    expect(assignment?.status).toBe('assigned');
  });

  it('clears offlineSince once the agent is seen online again', async () => {
    const oneMinuteAgo = new Date(Date.now() - 60 * 1000);
    const agent = await prisma.agent.create({
      data: { qiscusAgentId: 304, name: 'Eka', email: 'eka@mail.com', maxConcurrent: 2, offlineSince: oneMinuteAgo },
    });
    await prisma.assignment.create({
      data: { roomId: 'room-d', agentId: agent.id, status: 'assigned', assignedAt: new Date() },
    });

    nock(env.qiscusBaseUrl)
      .get('/api/v2/admin/service/available_agents')
      .query({ room_id: 'room-d' })
      .reply(200, {
        data: {
          agents: [{ id: 304, name: 'Eka', email: 'eka@mail.com', type: 2, type_as_string: 'agent', is_available: true, current_customer_count: 1 }],
        },
      });

    const reassignedCount = await reassignRoomsFromOfflineAgents();

    expect(reassignedCount).toBe(0);
    const updatedAgent = await prisma.agent.findUnique({ where: { id: agent.id } });
    expect(updatedAgent?.offlineSince).toBeNull();
    const assignment = await prisma.assignment.findFirst({ where: { roomId: 'room-d' } });
    expect(assignment?.status).toBe('assigned');
  });

  it('skips agents with no assigned rooms and makes no Qiscus API calls', async () => {
    nock.disableNetConnect();

    const reassignedCount = await reassignRoomsFromOfflineAgents();

    expect(reassignedCount).toBe(0);
    nock.enableNetConnect();
  });
});
