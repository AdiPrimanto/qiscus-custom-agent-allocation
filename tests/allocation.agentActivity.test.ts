import { afterAll, describe, expect, it } from 'vitest';
import { prisma } from '../src/db/prisma';
import { updateAgentQuota, recordAgentOffline, recordAgentOnline, listAgentActivity } from '../src/allocation/agentActivity';

describe('updateAgentQuota', () => {
  afterAll(async () => {
    const agents = await prisma.agent.findMany({ where: { qiscusAgentId: { in: [701, 702] } } });
    const agentIds = agents.map((a) => a.id);
    await prisma.agentActivityLog.deleteMany({ where: { agentId: { in: agentIds } } });
    await prisma.agent.deleteMany({ where: { id: { in: agentIds } } });
    await prisma.$disconnect();
  });

  it('logs a quota_change activity with old/new value and who changed it', async () => {
    const agent = await prisma.agent.create({
      data: { qiscusAgentId: 701, name: 'Eka', email: 'eka@mail.com', maxConcurrent: 2 },
    });

    const updated = await updateAgentQuota(agent.id, 5, 'alice');

    expect(updated.maxConcurrent).toBe(5);
    const logs = await prisma.agentActivityLog.findMany({ where: { agentId: agent.id } });
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({ type: 'quota_change', oldValue: 2, newValue: 5, changedBy: 'alice' });
  });

  it('does not log when the value is unchanged', async () => {
    const agent = await prisma.agent.create({
      data: { qiscusAgentId: 702, name: 'Fajar', email: 'fajar@mail.com', maxConcurrent: 3 },
    });

    await updateAgentQuota(agent.id, 3, 'bob');

    const logs = await prisma.agentActivityLog.findMany({ where: { agentId: agent.id } });
    expect(logs).toHaveLength(0);
  });

  it('throws when the agent does not exist', async () => {
    await expect(updateAgentQuota(999999, 5, 'alice')).rejects.toThrow();
  });
});

describe('recordAgentOffline / recordAgentOnline', () => {
  afterAll(async () => {
    const agents = await prisma.agent.findMany({ where: { qiscusAgentId: 703 } });
    const agentIds = agents.map((a) => a.id);
    await prisma.agentActivityLog.deleteMany({ where: { agentId: { in: agentIds } } });
    await prisma.agent.deleteMany({ where: { id: { in: agentIds } } });
    await prisma.$disconnect();
  });

  it('logs offline and online events with no changedBy — system-detected, not a user action', async () => {
    const agent = await prisma.agent.create({
      data: { qiscusAgentId: 703, name: 'Gita', email: 'gita@mail.com', maxConcurrent: 2 },
    });

    await recordAgentOffline(agent.id);
    await recordAgentOnline(agent.id);

    const logs = await prisma.agentActivityLog.findMany({ where: { agentId: agent.id }, orderBy: { occurredAt: 'asc' } });
    expect(logs).toHaveLength(2);
    expect(logs[0]).toMatchObject({ type: 'offline', changedBy: null, oldValue: null, newValue: null });
    expect(logs[1]).toMatchObject({ type: 'online', changedBy: null, oldValue: null, newValue: null });
  });
});

describe('listAgentActivity', () => {
  afterAll(async () => {
    const agents = await prisma.agent.findMany({ where: { qiscusAgentId: 704 } });
    const agentIds = agents.map((a) => a.id);
    await prisma.agentActivityLog.deleteMany({ where: { agentId: { in: agentIds } } });
    await prisma.agent.deleteMany({ where: { id: { in: agentIds } } });
    await prisma.$disconnect();
  });

  it('returns mixed event types newest first, with the agent name attached', async () => {
    const agent = await prisma.agent.create({
      data: { qiscusAgentId: 704, name: 'Hadi', email: 'hadi@mail.com', maxConcurrent: 2 },
    });

    await updateAgentQuota(agent.id, 4, 'alice');
    await recordAgentOffline(agent.id);

    const logs = await listAgentActivity();
    const forAgent = logs.filter((l) => l.agentId === agent.id);

    expect(forAgent).toHaveLength(2);
    expect(forAgent[0]).toMatchObject({ type: 'offline', agentName: 'Hadi' });
    expect(forAgent[1]).toMatchObject({ type: 'quota_change', oldValue: 2, newValue: 4, changedBy: 'alice', agentName: 'Hadi' });
  });
});
