import { createApp } from './app';
import { env } from './config/env';
import { reconcileWaitingAssignments } from './allocation/reconcile';

const app = createApp();

app.listen(env.port, () => {
  console.log(`qiscus-custom-agent-allocation listening on port ${env.port}`);
});

setInterval(() => {
  reconcileWaitingAssignments().catch((error) => {
    console.error('reconciliation failed', error);
  });
}, env.reconciliationIntervalMs);
