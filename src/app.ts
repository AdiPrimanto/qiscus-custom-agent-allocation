import express from 'express';
import { handleCustomAgentAllocation } from './webhooks/customAgentAllocation';

export function createApp() {
  const app = express();
  app.use(express.json());

  app.get('/health', (_req, res) => {
    res.status(200).json({ status: 'ok' });
  });

  app.post('/webhooks/custom-agent-allocation', handleCustomAgentAllocation);

  return app;
}
