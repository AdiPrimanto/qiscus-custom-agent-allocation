import { listAgentActivity } from '../../utils/agentActivity';

export default defineEventHandler(async () => {
  return listAgentActivity();
});
