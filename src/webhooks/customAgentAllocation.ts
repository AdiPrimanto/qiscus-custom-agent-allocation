import type { Request, Response } from 'express';
import { tryAssign } from '../allocation/allocate';
import type { CustomAgentAllocationWebhookPayload } from '../qiscus/types';

export async function handleCustomAgentAllocation(req: Request, res: Response): Promise<void> {
  const payload = req.body as CustomAgentAllocationWebhookPayload;

  if (!payload.room_id || !payload.email) {
    res.status(400).json({ error: 'room_id and email are required' });
    return;
  }

  await tryAssign(payload.room_id, payload.name);
  res.status(200).json({ status: 'ok' });
}
