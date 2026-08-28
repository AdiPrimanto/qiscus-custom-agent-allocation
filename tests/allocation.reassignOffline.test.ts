// tests/allocation.reassignOffline.test.ts
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import nock from 'nock';
import { env } from '../src/config/env';
import { prisma } from '../src/db/prisma';
import { reassignRoomsFromOfflineAgents } from '../src/allocation/reassignOffline';

function mockLogin(token = 'admin-token') {
  return nock(env.qiscusBaseUrl)
    .post('/api/v1/auth')
    .reply(200, { data: { user: { authentication_token: token } } });
}

function mockAllAgents(agents: Array<{ id: number; name: string; email: string; is_available: boolean }>) {
  return nock(env.qiscusBaseUrl)
    .get('/api/v2/admin/agents')
    .query(true)
    .reply(200, { data: { agents, meta: { after: null, before: null, per_page: agents.length, total_count: agents.length } }, status: 200 });
}

describe('reassignRoomsFromOfflineAgents', () => {
  afterEach(async () => {
    await prisma.agentActivityLog.deleteMany();
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

    mockLogin();
    mockAllAgents([{ id: 301, name: 'Dewi', email: 'dewi@mail.com', is_available: false }]);

    const reassignedCount = await reassignRoomsFromOfflineAgents();

    expect(reassignedCount).toBe(0);
    const updatedAgent = await prisma.agent.findUnique({ where: { id: agent.id } });
    expect(updatedAgent?.offlineSince).not.toBeNull();
    const assignment = await prisma.assignment.findFirst({ where: { roomId: 'room-a' } });
    expect(assignment?.status).toBe('assigned');
    expect(assignment?.agentId).toBe(agent.id);
    const activity = await prisma.agentActivityLog.findMany({ where: { agentId: agent.id } });
    expect(activity).toHaveLength(1);
    expect(activity[0]).toMatchObject({ type: 'offline', changedBy: null });
  });

  it('does not log another offline event on repeat sightings while already offline', async () => {
    const agent = await prisma.agent.create({
      data: { qiscusAgentId: 308, name: 'Indra', email: 'indra@mail.com', maxConcurrent: 2, offlineSince: new Date() },
    });

    mockLogin();
    mockAllAgents([{ id: 308, name: 'Indra', email: 'indra@mail.com', is_available: false }]);

    await reassignRoomsFromOfflineAgents();

    const activity = await prisma.agentActivityLog.findMany({ where: { agentId: agent.id } });
    expect(activity).toHaveLength(0);
  });

  it('detects an idle agent (zero assigned rooms) going offline — unreachable by the old room-scoped probe', async () => {
    const agent = await prisma.agent.create({
      data: { qiscusAgentId: 305, name: 'Fajar', email: 'fajar@mail.com', maxConcurrent: 2 },
    });

    mockLogin();
    mockAllAgents([{ id: 305, name: 'Fajar', email: 'fajar@mail.com', is_available: false }]);

    const reassignedCount = await reassignRoomsFromOfflineAgents();

    expect(reassignedCount).toBe(0);
    const updatedAgent = await prisma.agent.findUnique({ where: { id: agent.id } });
    expect(updatedAgent?.offlineSince).not.toBeNull();
  });

  it('requeues an agent’s assigned rooms once they have been offline past the grace period', async () => {
    const twoAndAHalfMinutesAgo = new Date(Date.now() - 2.5 * 60 * 1000);
    const agent = await prisma.agent.create({
      data: { qiscusAgentId: 302, name: 'Budi', email: 'budi@mail.com', maxConcurrent: 2, offlineSince: twoAndAHalfMinutesAgo },
    });
    await prisma.assignment.create({
      data: { roomId: 'room-b', agentId: agent.id, status: 'assigned', assignedAt: new Date() },
    });

    mockLogin();
    mockAllAgents([{ id: 302, name: 'Budi', email: 'budi@mail.com', is_available: false }]);

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

    mockLogin();
    mockAllAgents([{ id: 303, name: 'Citra', email: 'citra@mail.com', is_available: false }]);

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

    mockLogin();
    mockAllAgents([{ id: 304, name: 'Eka', email: 'eka@mail.com', is_available: true }]);

    const reassignedCount = await reassignRoomsFromOfflineAgents();

    expect(reassignedCount).toBe(0);
    const updatedAgent = await prisma.agent.findUnique({ where: { id: agent.id } });
    expect(updatedAgent?.offlineSince).toBeNull();
    const assignment = await prisma.assignment.findFirst({ where: { roomId: 'room-d' } });
    expect(assignment?.status).toBe('assigned');
    const activity = await prisma.agentActivityLog.findMany({ where: { agentId: agent.id } });
    expect(activity).toHaveLength(1);
    expect(activity[0]).toMatchObject({ type: 'online', changedBy: null });
  });

  it('treats an agent missing from the agent list entirely as offline', async () => {
    const oneMinuteAgo = new Date(Date.now() - 60 * 1000);
    await prisma.agent.create({
      data: { qiscusAgentId: 306, name: 'Gita', email: 'gita@mail.com', maxConcurrent: 2, offlineSince: oneMinuteAgo },
    });

    mockLogin();
    mockAllAgents([]); // Gita doesn't show up at all

    const reassignedCount = await reassignRoomsFromOfflineAgents();

    expect(reassignedCount).toBe(0);
    const updatedAgent = await prisma.agent.findFirst({ where: { qiscusAgentId: 306 } });
    expect(updatedAgent?.offlineSince).not.toBeNull();
  });

  it('re-logs in when the cached admin token gets rejected', async () => {
    const agent = await prisma.agent.create({
      data: { qiscusAgentId: 307, name: 'Hadi', email: 'hadi@mail.com', maxConcurrent: 2 },
    });

    nock(env.qiscusBaseUrl).post('/api/v1/auth').reply(200, { data: { user: { authentication_token: 'stale-token' } } });
    nock(env.qiscusBaseUrl).get('/api/v2/admin/agents').query(true).reply(401, { errors: ['unauthenticated'] });
    nock(env.qiscusBaseUrl).post('/api/v1/auth').reply(200, { data: { user: { authentication_token: 'fresh-token' } } });
    nock(env.qiscusBaseUrl)
      .get('/api/v2/admin/agents')
      .query(true)
      .reply(200, {
        data: { agents: [{ id: 307, name: 'Hadi', email: 'hadi@mail.com', is_available: false }], meta: { after: null, before: null, per_page: 1, total_count: 1 } },
        status: 200,
      });

    const reassignedCount = await reassignRoomsFromOfflineAgents();

    expect(reassignedCount).toBe(0);
    const updatedAgent = await prisma.agent.findUnique({ where: { id: agent.id } });
    expect(updatedAgent?.offlineSince).not.toBeNull();
  });

  it('skips agents with no local rows and makes no Qiscus API calls', async () => {
    nock.disableNetConnect();

    const reassignedCount = await reassignRoomsFromOfflineAgents();

    expect(reassignedCount).toBe(0);
    nock.enableNetConnect();
  });
});
