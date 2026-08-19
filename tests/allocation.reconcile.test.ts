import { afterAll, afterEach, describe, expect, it } from 'vitest';
import nock from 'nock';
import { env } from '../src/config/env';
import { prisma } from '../src/db/prisma';
import { reconcileWaitingAssignments } from '../src/allocation/reconcile';

describe('reconcileWaitingAssignments', () => {
  afterEach(async () => {
    await prisma.assignment.deleteMany();
    await prisma.agent.deleteMany();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('makes no Qiscus API calls when there is nothing waiting', async () => {
    nock.disableNetConnect();

    const assignedCount = await reconcileWaitingAssignments();

    expect(assignedCount).toBe(0);
    nock.enableNetConnect();
  });

  it('assigns the oldest waiting room first when a slot frees up', async () => {
    const older = await prisma.assignment.create({
      data: {
        roomId: 'room-older',
        customerIdentifier: 'old@mail.com',
        status: 'waiting',
        createdAt: new Date('2026-01-01T00:00:00Z'),
      },
    });
    await prisma.assignment.create({
      data: {
        roomId: 'room-newer',
        customerIdentifier: 'new@mail.com',
        status: 'waiting',
        createdAt: new Date('2026-01-01T00:01:00Z'),
      },
    });

    nock(env.qiscusBaseUrl)
      .get('/api/v2/admin/service/available_agents')
      .query({ room_id: 'room-older' })
      .reply(200, {
        data: {
          agents: [{ id: 40, name: 'Agent A', email: 'a@mail.com', type: 2, type_as_string: 'agent', is_available: true, current_customer_count: 0 }],
        },
      });
    nock(env.qiscusBaseUrl)
      .post('/api/v1/admin/service/assign_agent', 'room_id=room-older&agent_id=40&replace_latest_agent=true')
      .reply(200, { data: { added_agent: { id: 40, name: 'Agent A', email: 'a@mail.com', is_available: true } } });

    nock(env.qiscusBaseUrl)
      .get('/api/v2/admin/service/available_agents')
      .query({ room_id: 'room-newer' })
      .reply(200, { data: { agents: [] } });

    const assignedCount = await reconcileWaitingAssignments();

    expect(assignedCount).toBe(1);
    const olderResult = await prisma.assignment.findUnique({ where: { id: older.id } });
    expect(olderResult?.status).toBe('assigned');
  });
});
