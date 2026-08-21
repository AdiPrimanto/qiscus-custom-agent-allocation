import type { Request, Response } from 'express';
import { prisma } from '../db/prisma';
import { reconcileWaitingAssignments } from '../allocation/reconcile';
import type { MarkAsResolvedWebhookPayload } from '../qiscus/types';
import { describeApiError } from '../qiscus/errors';

const RESOLVE_UPDATE_MAX_ATTEMPTS = 3;
const RESOLVE_UPDATE_RETRY_DELAY_MS = 100;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Qiscus already considers this room resolved by the time this webhook
// fires. A transient DB blip on our single write shouldn't permanently
// desync us from that (the agent's local capacity count would stay
// inflated forever otherwise) — retry a couple of times before giving up.
async function markRoomResolvedWithRetry(roomId: string): Promise<void> {
  for (let attempt = 1; attempt <= RESOLVE_UPDATE_MAX_ATTEMPTS; attempt++) {
    try {
      await prisma.assignment.updateMany({
        where: { roomId, status: { in: ['waiting', 'assigned'] } },
        data: { status: 'resolved', resolvedAt: new Date() },
      });
      return;
    } catch (error) {
      if (attempt === RESOLVE_UPDATE_MAX_ATTEMPTS) {
        console.error(`mark-as-resolved: giving up on room ${roomId} after ${attempt} attempts`, describeApiError(error));
        throw error;
      }
      console.error(`mark-as-resolved: attempt ${attempt} failed for room ${roomId}, retrying`, describeApiError(error));
      await sleep(RESOLVE_UPDATE_RETRY_DELAY_MS * attempt);
    }
  }
}

export async function handleMarkAsResolved(req: Request, res: Response): Promise<void> {
  const payload = req.body as MarkAsResolvedWebhookPayload;
  const roomId = payload.service?.room_id;

  if (!roomId) {
    res.status(400).json({ error: 'service.room_id is required' });
    return;
  }

  await markRoomResolvedWithRetry(roomId);

  await reconcileWaitingAssignments();
  res.status(200).json({ status: 'ok' });
}
