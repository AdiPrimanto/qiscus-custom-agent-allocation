import { createApp } from './app';
import { env } from './config/env';
import { reconcileWaitingAssignments } from './allocation/reconcile';
import { reassignRoomsFromOfflineAgents } from './allocation/reassignOffline';

const app = createApp();

app.listen(env.port, () => {
  console.log(`qiscus-custom-agent-allocation listening on port ${env.port}`);
});

setInterval(() => {
  reconcileWaitingAssignments().catch((error) => {
    console.error('reconciliation failed', error);
  });
  reassignRoomsFromOfflineAgents().catch((error) => {
    console.error('reassign-offline-agents failed', error);
  });
}, env.reconciliationIntervalMs);
