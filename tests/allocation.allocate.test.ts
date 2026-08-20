// tests/allocation.allocate.test.ts
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import nock from 'nock';
import { env } from '../src/config/env';
import { prisma } from '../src/db/prisma';
import { tryAssign } from '../src/allocation/allocate';

describe('tryAssign', () => {
  afterEach(async () => {
    await prisma.assignment.deleteMany();
    await prisma.agent.deleteMany();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('assigns the least busy online agent under quota', async () => {
    nock(env.qiscusBaseUrl)
      .get('/api/v2/admin/service/available_agents')
      .query({ room_id: 'room-1' })
      .reply(200, {
        data: {
          agents: [
            { id: 10, name: 'Agent Busy', email: 'busy@mail.com', type: 2, type_as_string: 'agent', is_available: true, current_customer_count: 1 },
            { id: 11, name: 'Agent Free', email: 'free@mail.com', type: 2, type_as_string: 'agent', is_available: true, current_customer_count: 0 },
          ],
        },
      });

    nock(env.qiscusBaseUrl)
      .post('/api/v1/admin/service/assign_agent', 'room_id=room-1&agent_id=11&replace_latest_agent=true')
      .reply(200, { data: { added_agent: { id: 11, name: 'Agent Free', email: 'free@mail.com', is_available: true } } });

    const result = await tryAssign('room-1', 'customer@mail.com');

    expect(result.status).toBe('assigned');
    const agent = await prisma.agent.findUnique({ where: { qiscusAgentId: 11 } });
    expect(result.agentId).toBe(agent?.id);
  });

  it('ignores offline and over-quota agents, leaving the assignment waiting', async () => {
    nock(env.qiscusBaseUrl)
      .get('/api/v2/admin/service/available_agents')
      .query({ room_id: 'room-2' })
      .reply(200, {
        data: {
          agents: [
            { id: 20, name: 'Agent Offline', email: 'offline@mail.com', type: 2, type_as_string: 'agent', is_available: false, current_customer_count: 0 },
            { id: 21, name: 'Agent Full', email: 'full@mail.com', type: 2, type_as_string: 'agent', is_available: true, current_customer_count: 2 },
          ],
        },
      });

    await prisma.agent.create({ data: { qiscusAgentId: 21, name: 'Agent Full', email: 'full@mail.com', maxConcurrent: 2 } });

    const result = await tryAssign('room-2', 'customer2@mail.com');

    expect(result.status).toBe('waiting');
    expect(result.agentId).toBeNull();
  });

  it('does not call the assign API again for a room that is already assigned', async () => {
    const scope = nock(env.qiscusBaseUrl)
      .get('/api/v2/admin/service/available_agents')
      .query({ room_id: 'room-3' })
      .reply(200, {
        data: {
          agents: [{ id: 30, name: 'Agent A', email: 'a@mail.com', type: 2, type_as_string: 'agent', is_available: true, current_customer_count: 0 }],
        },
      });

    nock(env.qiscusBaseUrl)
      .post('/api/v1/admin/service/assign_agent', 'room_id=room-3&agent_id=30&replace_latest_agent=true')
      .reply(200, { data: { added_agent: { id: 30, name: 'Agent A', email: 'a@mail.com', is_available: true } } });

    await tryAssign('room-3', 'customer3@mail.com');
    const second = await tryAssign('room-3', 'customer3@mail.com');

    expect(second.status).toBe('assigned');
    expect(scope.isDone()).toBe(true);
  });

  it('does not jump the queue ahead of an older waiting room', async () => {
    await prisma.assignment.create({
      data: {
        roomId: 'room-older',
        customerIdentifier: 'old@mail.com',
        status: 'waiting',
        createdAt: new Date('2026-01-01T00:00:00Z'),
      },
    });

    const scope = nock(env.qiscusBaseUrl)
      .get('/api/v2/admin/service/available_agents')
      .query({ room_id: 'room-newer' })
      .reply(200, {
        data: {
          agents: [{ id: 50, name: 'Agent A', email: 'a@mail.com', type: 2, type_as_string: 'agent', is_available: true, current_customer_count: 0 }],
        },
      });

    const result = await tryAssign('room-newer', 'new@mail.com');

    expect(result.status).toBe('waiting');
    expect(scope.isDone()).toBe(false);
  });

  it('does not exceed an agent max_concurrent when many rooms race for the same agent', async () => {
    // Qiscus's current_customer_count is deliberately static (always 0) across
    // every call, simulating the exact staleness that caused the demo bug: the
    // count hasn't caught up yet when the next concurrent request reads it.
    nock(env.qiscusBaseUrl)
      .get('/api/v2/admin/service/available_agents')
      .query(() => true)
      .times(5)
      .reply(200, {
        data: {
          agents: [
            { id: 60, name: 'Agent Race', email: 'race@mail.com', type: 2, type_as_string: 'agent', is_available: true, current_customer_count: 0 },
          ],
        },
      });

    nock(env.qiscusBaseUrl)
      .post('/api/v1/admin/service/assign_agent')
      .times(5)
      .reply(200, { data: { added_agent: { id: 60, name: 'Agent Race', email: 'race@mail.com', is_available: true } } });

    const roomIds = ['room-race-1', 'room-race-2', 'room-race-3', 'room-race-4', 'room-race-5'];
    await Promise.all(roomIds.map((roomId) => tryAssign(roomId, `${roomId}@mail.com`)));

    const agent = await prisma.agent.findUnique({ where: { qiscusAgentId: 60 } });
    const assignedCount = await prisma.assignment.count({ where: { agentId: agent?.id, status: 'assigned' } });
    const waitingCount = await prisma.assignment.count({ where: { roomId: { in: roomIds }, status: 'waiting' } });

    // Exactly max_concurrent get assigned — serializing the whole decide+commit
    // sequence also makes the FIFO guard correct, so the rest never even reach
    // pickAgent and stay queued instead of racing Qiscus for the same slot.
    expect(assignedCount).toBe(2);
    expect(waitingCount).toBe(3);
  });
});
