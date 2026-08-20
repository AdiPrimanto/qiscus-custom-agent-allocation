import type { Agent, Prisma, PrismaClient } from '@prisma/client';
import { env } from '../config/env';
import type { AvailableAgent } from '../qiscus/types';

type Db = PrismaClient | Prisma.TransactionClient;

export async function getOrCreateLocalAgent(
  db: Db,
  qiscusAgent: Pick<AvailableAgent, 'id' | 'name' | 'email'>,
): Promise<Agent> {
  return db.agent.upsert({
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
