// tests/db.prisma.test.ts
import { afterAll, describe, expect, it } from 'vitest';
import { prisma } from '../src/db/prisma';

describe('prisma client', () => {
  afterAll(async () => {
    await prisma.assignment.deleteMany();
    await prisma.agent.deleteMany();
    await prisma.$disconnect();
  });

  it('creates and reads an agent with an assignment', async () => {
    const agent = await prisma.agent.create({
      data: { qiscusAgentId: 1, name: 'Dewi', email: 'dewi@mail.com', maxConcurrent: 2 },
    });

    const assignment = await prisma.assignment.create({
      data: {
        roomId: 'room-1',
        customerIdentifier: 'customer@mail.com',
        agentId: agent.id,
        status: 'assigned',
        assignedAt: new Date(),
      },
    });

    const found = await prisma.assignment.findUnique({
      where: { id: assignment.id },
      include: { agent: true },
    });

    expect(found?.status).toBe('assigned');
    expect(found?.agent?.qiscusAgentId).toBe(1);
  });
});
