import express from 'express';
import { handleCustomAgentAllocation } from './webhooks/customAgentAllocation';
import { handleMarkAsResolved } from './webhooks/markAsResolved';

export function createApp() {
  const app = express();
  app.use(express.json());

  app.get('/health', (_req, res) => {
    res.status(200).json({ status: 'ok' });
  });

  app.post('/webhooks/custom-agent-allocation', handleCustomAgentAllocation);
  app.post('/webhooks/mark-as-resolved', handleMarkAsResolved);

  return app;
}
