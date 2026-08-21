import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
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
      data: { roomId: '1961380', agentId: agent.id, status: 'assigned', assignedAt: new Date() },
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

  it('marks a still-waiting room as resolved so it stops being retried by reconciliation', async () => {
    await prisma.assignment.create({
      data: { roomId: '1961381', status: 'waiting' },
    });

    const response = await request(app)
      .post(`/webhooks/${env.webhookSecret}/mark-as-resolved`)
      .send({
        service: { id: 237789, room_id: '1961381', is_resolved: true, notes: null, first_comment_id: '15828800', last_comment_id: 15828826, source: 'qiscus' },
        resolved_by: { id: 1576, email: 'admin@qiscus.com', name: 'Dewi Corp', type: 'admin', is_available: true },
        customer: { user_id: 'waiting@mail.com' },
      });

    expect(response.status).toBe(200);
    const resolved = await prisma.assignment.findFirst({ where: { roomId: '1961381' } });
    expect(resolved?.status).toBe('resolved');
  });

  it('rejects a payload missing service.room_id', async () => {
    const response = await request(app).post(`/webhooks/${env.webhookSecret}/mark-as-resolved`).send({ service: {} });

    expect(response.status).toBe(400);
  });

  it('rejects requests with an incorrect webhook secret and leaves the assignment unresolved', async () => {
    const agent = await prisma.agent.create({ data: { qiscusAgentId: 99, name: 'Dewi', email: 'dewi@mail.com', maxConcurrent: 2 } });
    await prisma.assignment.create({
      data: { roomId: '1961380', agentId: agent.id, status: 'assigned', assignedAt: new Date() },
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

  it('retries a transient updateMany failure instead of failing the whole request', async () => {
    const agent = await prisma.agent.create({ data: { qiscusAgentId: 199, name: 'Dewi', email: 'retry@mail.com', maxConcurrent: 2 } });
    await prisma.assignment.create({
      data: { roomId: 'room-retry', agentId: agent.id, status: 'assigned', assignedAt: new Date() },
    });

    const updateManySpy = vi.spyOn(prisma.assignment, 'updateMany').mockRejectedValueOnce(new Error('transient db blip'));
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const response = await request(app)
      .post(`/webhooks/${env.webhookSecret}/mark-as-resolved`)
      .send({
        service: { id: 1, room_id: 'room-retry', is_resolved: true, notes: null, first_comment_id: '1', last_comment_id: 1, source: 'qiscus' },
        resolved_by: { id: 1, email: 'admin@qiscus.com', name: 'Admin', type: 'admin', is_available: true },
        customer: { user_id: 'x@mail.com' },
      });

    expect(response.status).toBe(200);
    expect(updateManySpy).toHaveBeenCalledTimes(2);
    const resolved = await prisma.assignment.findFirst({ where: { roomId: 'room-retry' } });
    expect(resolved?.status).toBe('resolved');
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('room-retry'), expect.any(Error));

    errorSpy.mockRestore();

    updateManySpy.mockRestore();
  });
});
