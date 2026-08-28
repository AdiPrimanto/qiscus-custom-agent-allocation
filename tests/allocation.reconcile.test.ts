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
        status: 'waiting',
        createdAt: new Date(Date.now() - 60_000),
      },
    });
    await prisma.assignment.create({
      data: {
        roomId: 'room-newer',
        status: 'waiting',
        createdAt: new Date(),
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

  it('keeps reconciling later rooms when an earlier one fails', async () => {
    await prisma.assignment.create({
      data: {
        roomId: 'room-fails',
        status: 'waiting',
        createdAt: new Date(Date.now() - 60_000),
      },
    });
    await prisma.assignment.create({
      data: {
        roomId: 'room-still-works',
        status: 'waiting',
        createdAt: new Date(),
      },
    });

    nock(env.qiscusBaseUrl)
      .get('/api/v2/admin/service/available_agents')
      .query({ room_id: 'room-fails' })
      .replyWithError('connection reset');

    nock(env.qiscusBaseUrl)
      .get('/api/v2/admin/service/available_agents')
      .query({ room_id: 'room-still-works' })
      .reply(200, {
        data: {
          agents: [{ id: 41, name: 'Agent B', email: 'b@mail.com', type: 2, type_as_string: 'agent', is_available: true, current_customer_count: 0 }],
        },
      });
    nock(env.qiscusBaseUrl)
      .post('/api/v1/admin/service/assign_agent', 'room_id=room-still-works&agent_id=41&replace_latest_agent=true')
      .reply(200, { data: { added_agent: { id: 41, name: 'Agent B', email: 'b@mail.com', is_available: true } } });

    const assignedCount = await reconcileWaitingAssignments();

    expect(assignedCount).toBe(1);
    const failed = await prisma.assignment.findFirst({ where: { roomId: 'room-fails' } });
    expect(failed?.status).toBe('waiting');
    const worked = await prisma.assignment.findFirst({ where: { roomId: 'room-still-works' } });
    expect(worked?.status).toBe('assigned');
  });

  it('gives up on a room Qiscus already rejected with a 4xx, without calling Qiscus again for it', async () => {
    const rejected = await prisma.assignment.create({
      data: {
        roomId: 'room-rejected',
        status: 'waiting',
        createdAt: new Date(Date.now() - 6 * 60 * 60 * 1000),
        lastAssignErrorAt: new Date(Date.now() - 60 * 1000),
        lastAssignErrorStatus: 400,
      },
    });
    await prisma.assignment.create({
      data: { roomId: 'room-fresh', status: 'waiting', createdAt: new Date() },
    });

    const rejectedRoomCall = nock(env.qiscusBaseUrl)
      .get('/api/v2/admin/service/available_agents')
      .query({ room_id: 'room-rejected' })
      .reply(200, { data: { agents: [] } });

    nock(env.qiscusBaseUrl)
      .get('/api/v2/admin/service/available_agents')
      .query({ room_id: 'room-fresh' })
      .reply(200, {
        data: {
          agents: [{ id: 42, name: 'Agent C', email: 'c@mail.com', type: 2, type_as_string: 'agent', is_available: true, current_customer_count: 0 }],
        },
      });
    nock(env.qiscusBaseUrl)
      .post('/api/v1/admin/service/assign_agent', 'room_id=room-fresh&agent_id=42&replace_latest_agent=true')
      .reply(200, { data: { added_agent: { id: 42, name: 'Agent C', email: 'c@mail.com', is_available: true } } });

    const assignedCount = await reconcileWaitingAssignments();

    expect(assignedCount).toBe(1);
    expect(rejectedRoomCall.isDone()).toBe(false);
    const rejectedResult = await prisma.assignment.findUnique({ where: { id: rejected.id } });
    expect(rejectedResult?.status).toBe('waiting');
  });

  it('keeps retrying a long-waiting room that has no recorded error — plain capacity backlog, not a broken room', async () => {
    const backlogged = await prisma.assignment.create({
      data: {
        roomId: 'room-backlogged',
        status: 'waiting',
        createdAt: new Date(Date.now() - 6 * 60 * 60 * 1000),
      },
    });

    nock(env.qiscusBaseUrl)
      .get('/api/v2/admin/service/available_agents')
      .query({ room_id: 'room-backlogged' })
      .reply(200, {
        data: {
          agents: [{ id: 43, name: 'Agent D', email: 'd@mail.com', type: 2, type_as_string: 'agent', is_available: true, current_customer_count: 0 }],
        },
      });
    nock(env.qiscusBaseUrl)
      .post('/api/v1/admin/service/assign_agent', 'room_id=room-backlogged&agent_id=43&replace_latest_agent=true')
      .reply(200, { data: { added_agent: { id: 43, name: 'Agent D', email: 'd@mail.com', is_available: true } } });

    const assignedCount = await reconcileWaitingAssignments();

    expect(assignedCount).toBe(1);
    const result = await prisma.assignment.findUnique({ where: { id: backlogged.id } });
    expect(result?.status).toBe('assigned');
  });

  it('records the HTTP status when assign_agent fails, so the next cycle knows to give up', async () => {
    const assignment = await prisma.assignment.create({
      data: { roomId: 'room-will-fail', status: 'waiting', createdAt: new Date() },
    });

    nock(env.qiscusBaseUrl)
      .get('/api/v2/admin/service/available_agents')
      .query({ room_id: 'room-will-fail' })
      .reply(200, {
        data: {
          agents: [{ id: 44, name: 'Agent E', email: 'e@mail.com', type: 2, type_as_string: 'agent', is_available: true, current_customer_count: 0 }],
        },
      });
    nock(env.qiscusBaseUrl)
      .post('/api/v1/admin/service/assign_agent', 'room_id=room-will-fail&agent_id=44&replace_latest_agent=true')
      .reply(400, { errors: ['room is already resolved'] });

    await reconcileWaitingAssignments();

    const result = await prisma.assignment.findUnique({ where: { id: assignment.id } });
    expect(result?.status).toBe('waiting');
    expect(result?.lastAssignErrorStatus).toBe(400);
    expect(result?.lastAssignErrorAt).not.toBeNull();
  });
});
