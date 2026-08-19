import express from 'express';
import { env } from './config/env';
import { handleCustomAgentAllocation } from './webhooks/customAgentAllocation';
import { handleMarkAsResolved } from './webhooks/markAsResolved';

function requireWebhookSecret(req: express.Request, res: express.Response, next: express.NextFunction): void {
  if (req.params.webhookSecret !== env.webhookSecret) {
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

  return app;
}
