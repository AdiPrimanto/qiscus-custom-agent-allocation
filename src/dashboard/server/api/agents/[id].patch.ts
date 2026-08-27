import { prisma } from '../../utils/prisma';

const MIN_MAX_CONCURRENT = 1;
const MAX_MAX_CONCURRENT = 100;

export default defineEventHandler(async (event) => {
  const idParam = getRouterParam(event, 'id');
  const id = Number(idParam);
  if (!idParam || !Number.isInteger(id)) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid agent id' });
  }

  const body = await readBody(event);
  const maxConcurrent = body?.maxConcurrent;

  if (
    typeof maxConcurrent !== 'number' ||
    !Number.isInteger(maxConcurrent) ||
    maxConcurrent < MIN_MAX_CONCURRENT ||
    maxConcurrent > MAX_MAX_CONCURRENT
  ) {
    throw createError({
      statusCode: 400,
      statusMessage: `maxConcurrent must be an integer between ${MIN_MAX_CONCURRENT} and ${MAX_MAX_CONCURRENT}`,
    });
  }

  try {
    const agent = await prisma.agent.update({
      where: { id },
      data: { maxConcurrent },
    });
    return { id: agent.id, maxConcurrent: agent.maxConcurrent };
  } catch {
    throw createError({ statusCode: 404, statusMessage: 'Agent not found' });
  }
});
