import { afterAll, describe, expect, it } from 'vitest';
import { prisma } from '../src/db/prisma';
import { getOrCreateLocalAgent } from '../src/allocation/agents';

describe('getOrCreateLocalAgent', () => {
  afterAll(async () => {
    await prisma.agent.deleteMany({
      where: { qiscusAgentId: { in: [501, 502] } },
    });
    await prisma.$disconnect();
  });

  it('creates a new local agent on first sight with the default quota', async () => {
    const agent = await getOrCreateLocalAgent({ id: 501, name: 'Budi', email: 'budi@mail.com' });

    expect(agent.qiscusAgentId).toBe(501);
    expect(agent.maxConcurrent).toBe(2);
  });

  it('reuses the existing local agent and updates its name on repeat sightings', async () => {
    await getOrCreateLocalAgent({ id: 502, name: 'Citra', email: 'citra@mail.com' });
    const updated = await getOrCreateLocalAgent({ id: 502, name: 'Citra Renamed', email: 'citra@mail.com' });

    const all = await prisma.agent.findMany({ where: { qiscusAgentId: 502 } });

    expect(all).toHaveLength(1);
    expect(updated.name).toBe('Citra Renamed');
    expect(updated.maxConcurrent).toBe(2);
  });
});
