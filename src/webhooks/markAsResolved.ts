import type { Request, Response } from 'express';
import { prisma } from '../db/prisma';
import { reconcileWaitingAssignments } from '../allocation/reconcile';
import type { MarkAsResolvedWebhookPayload } from '../qiscus/types';

export async function handleMarkAsResolved(req: Request, res: Response): Promise<void> {
  const payload = req.body as MarkAsResolvedWebhookPayload;
  const roomId = payload.service?.room_id;

  if (!roomId) {
    res.status(400).json({ error: 'service.room_id is required' });
    return;
  }

  await prisma.assignment.updateMany({
    where: { roomId, status: { in: ['waiting', 'assigned'] } },
    data: { status: 'resolved', resolvedAt: new Date() },
  });

  await reconcileWaitingAssignments();
  res.status(200).json({ status: 'ok' });
}
