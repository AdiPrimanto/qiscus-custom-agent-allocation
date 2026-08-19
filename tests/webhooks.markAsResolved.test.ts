import { afterAll, afterEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { env } from '../src/config/env';
import { prisma } from '../src/db/prisma';
import { createApp } from '../src/app';

const app = createApp();

describe('POST /webhooks/mark-as-resolved', () => {
  afterEach(async () => {
    await prisma.assignment.deleteMany();
    await prisma.agent.deleteMany();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('marks the matching assigned room as resolved', async () => {
    const agent = await prisma.agent.create({ data: { qiscusAgentId: 99, name: 'Dewi', email: 'dewi@mail.com', maxConcurrent: 2 } });
    await prisma.assignment.create({
      data: { roomId: '1961380', customerIdentifier: 'auliaollegh@gmail.com', agentId: agent.id, status: 'assigned', assignedAt: new Date() },
    });

    const response = await request(app)
      .post(`/webhooks/${env.webhookSecret}/mark-as-resolved`)
      .send({
        service: { id: 237788, room_id: '1961380', is_resolved: true, notes: null, first_comment_id: '15828799', last_comment_id: 15828825, source: 'qiscus' },
        resolved_by: { id: 1576, email: 'admin@qiscus.com', name: 'Dewi Corp', type: 'admin', is_available: true },
        customer: { user_id: 'auliaollegh@gmail.com' },
      });

    expect(response.status).toBe(200);
    const resolved = await prisma.assignment.findFirst({ where: { roomId: '1961380' } });
    expect(resolved?.status).toBe('resolved');
    expect(resolved?.resolvedAt).not.toBeNull();
  });

  it('rejects a payload missing service.room_id', async () => {
    const response = await request(app).post(`/webhooks/${env.webhookSecret}/mark-as-resolved`).send({ service: {} });

    expect(response.status).toBe(400);
  });

  it('rejects requests with an incorrect webhook secret and leaves the assignment unresolved', async () => {
    const agent = await prisma.agent.create({ data: { qiscusAgentId: 99, name: 'Dewi', email: 'dewi@mail.com', maxConcurrent: 2 } });
    await prisma.assignment.create({
      data: { roomId: '1961380', customerIdentifier: 'auliaollegh@gmail.com', agentId: agent.id, status: 'assigned', assignedAt: new Date() },
    });

    const response = await request(app)
      .post('/webhooks/wrong-secret/mark-as-resolved')
      .send({
        service: { id: 237788, room_id: '1961380', is_resolved: true, notes: null, first_comment_id: '15828799', last_comment_id: 15828825, source: 'qiscus' },
        resolved_by: { id: 1576, email: 'admin@qiscus.com', name: 'Dewi Corp', type: 'admin', is_available: true },
        customer: { user_id: 'auliaollegh@gmail.com' },
      });

    expect(response.status).toBe(404);
    const assignment = await prisma.assignment.findFirst({ where: { roomId: '1961380' } });
    expect(assignment?.status).toBe('assigned');
    expect(assignment?.resolvedAt).toBeNull();
  });
});
