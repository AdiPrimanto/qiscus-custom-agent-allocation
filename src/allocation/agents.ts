import type { Agent } from '@prisma/client';
import { prisma } from '../db/prisma';
import { env } from '../config/env';
import type { AvailableAgent } from '../qiscus/types';

export async function getOrCreateLocalAgent(
  qiscusAgent: Pick<AvailableAgent, 'id' | 'name' | 'email'>,
): Promise<Agent> {
  return prisma.agent.upsert({
    where: { qiscusAgentId: qiscusAgent.id },
    update: { name: qiscusAgent.name, email: qiscusAgent.email },
    create: {
      qiscusAgentId: qiscusAgent.id,
      name: qiscusAgent.name,
      email: qiscusAgent.email,
      maxConcurrent: env.maxConcurrentDefault,
    },
  });
}
