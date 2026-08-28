import { updateAgentQuota } from '../../utils/agentActivity';

// 0 is a valid quota — it's how an agent is "paused" (see allocate.ts:
// effectiveCount >= maxConcurrent excludes them from every eligibility check,
// no separate pause flag needed).
const MIN_MAX_CONCURRENT = 0;
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
    const agent = await updateAgentQuota(id, maxConcurrent, event.context.dashboardUser ?? null);
    return { id: agent.id, maxConcurrent: agent.maxConcurrent };
  } catch {
    throw createError({ statusCode: 404, statusMessage: 'Agent not found' });
  }
});
