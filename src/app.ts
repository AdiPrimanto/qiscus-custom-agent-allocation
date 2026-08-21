import crypto from 'node:crypto';
import express from 'express';
import { env } from './config/env';
import { handleCustomAgentAllocation } from './webhooks/customAgentAllocation';
import { handleMarkAsResolved } from './webhooks/markAsResolved';
import { describeApiError } from './qiscus/errors';

function requireWebhookSecret(req: express.Request, res: express.Response, next: express.NextFunction): void {
  const provided = Buffer.from(String(req.params.webhookSecret ?? ''), 'utf8');
  const expected = Buffer.from(env.webhookSecret, 'utf8');

  if (provided.length !== expected.length || !crypto.timingSafeEqual(provided, expected)) {
    res.status(404).end();
    return;
  }
  next();
}

export function createApp() {
  const app = express();
  app.use(express.json());

  app.get('/health', (_req, res) => {
    res.status(200).json({ status: 'ok' });
  });

  app.post('/webhooks/:webhookSecret/custom-agent-allocation', requireWebhookSecret, handleCustomAgentAllocation);
  app.post('/webhooks/:webhookSecret/mark-as-resolved', requireWebhookSecret, handleMarkAsResolved);

  app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    console.error('unhandled request error', describeApiError(err));
    res.status(500).json({ error: 'internal error' });
  });

  return app;
}
