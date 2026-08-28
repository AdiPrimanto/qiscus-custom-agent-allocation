import { prisma } from '../../../utils/prisma';
import { attemptAssignment } from '../../../../../allocation/reconcile';

// Manual escape hatch for a room reconcile has given up on (a recorded 4xx —
// see isPermanentlyRejected in reconcile.ts). Reuses the exact same
// allocation logic reconcile uses, not a separate implementation, so this
// stays correct under the same advisory-locked transaction guarantees.
export default defineEventHandler(async (event) => {
  const idParam = getRouterParam(event, 'id');
  const id = Number(idParam);
  if (!idParam || !Number.isInteger(id)) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid assignment id' });
  }

  const assignment = await prisma.assignment.findUnique({ where: { id } });
  if (!assignment) {
    throw createError({ statusCode: 404, statusMessage: 'Assignment not found' });
  }
  if (assignment.status !== 'waiting') {
    throw createError({ statusCode: 400, statusMessage: 'Only waiting assignments can be retried' });
  }

  const result = await attemptAssignment(assignment);

  return {
    status: result.status,
    agentId: result.agentId,
    lastAssignErrorStatus: result.lastAssignErrorStatus,
  };
});
