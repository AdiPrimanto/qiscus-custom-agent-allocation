import { afterAll, afterEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import nock from 'nock';
import { env } from '../src/config/env';
import { prisma } from '../src/db/prisma';
import { createApp } from '../src/app';

const app = createApp();

describe('POST /webhooks/custom-agent-allocation', () => {
  afterEach(async () => {
    await prisma.assignment.deleteMany();
    await prisma.agent.deleteMany();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('assigns an online agent under quota to a new customer', async () => {
    nock(env.qiscusBaseUrl)
      .get('/api/v2/admin/service/available_agents')
      .query({ room_id: '1905692' })
      .reply(200, {
        data: {
          agents: [{ id: 22, name: 'dewi', email: 'dewi@mail.com', type: 2, type_as_string: 'agent', is_available: true, current_customer_count: 0 }],
        },
      });
    nock(env.qiscusBaseUrl)
      .post('/api/v1/admin/service/assign_agent', 'room_id=1905692&agent_id=22')
      .reply(200, { data: { added_agent: { id: 22, name: 'dewi', email: 'dewi@mail.com', is_available: true } } });

    const response = await request(app)
      .post(`/webhooks/${env.webhookSecret}/custom-agent-allocation`)
      .send({
        app_id: 'oni-bgo2lummmhvzqxbt5',
        source: 'qiscus',
        name: 'sudah',
        email: 'sudah@gmail.com',
        avatar_url: 'https://example.com/avatar.png',
        extras: '{"timezone_offset":7}',
        is_resolved: false,
        room_id: '1905692',
        candidate_agent: {
          id: 22,
          name: 'dewi',
          email: 'dewi@mail.com',
          is_available: true,
          type: 2,
          type_as_string: 'agent',
          assigned_rules: ['qiscus_messaging'],
        },
      });

    expect(response.status).toBe(200);
    const assignment = await prisma.assignment.findFirst({ where: { roomId: '1905692' } });
    expect(assignment?.status).toBe('assigned');
  });

  it('rejects a payload missing room_id', async () => {
    const response = await request(app).post(`/webhooks/${env.webhookSecret}/custom-agent-allocation`).send({ email: 'x@mail.com' });

    expect(response.status).toBe(400);
  });

  it('rejects requests with an incorrect webhook secret and creates no assignment', async () => {
    const response = await request(app)
      .post('/webhooks/wrong-secret/custom-agent-allocation')
      .send({
        app_id: 'oni-bgo2lummmhvzqxbt5',
        source: 'qiscus',
        name: 'sudah',
        email: 'sudah@gmail.com',
        avatar_url: 'https://example.com/avatar.png',
        extras: '{"timezone_offset":7}',
        is_resolved: false,
        room_id: '9999999',
        candidate_agent: {
          id: 22,
          name: 'dewi',
          email: 'dewi@mail.com',
          is_available: true,
          type: 2,
          type_as_string: 'agent',
          assigned_rules: ['qiscus_messaging'],
        },
      });

    expect(response.status).toBe(404);
    const assignment = await prisma.assignment.findFirst({ where: { roomId: '9999999' } });
    expect(assignment).toBeNull();
  });
});
