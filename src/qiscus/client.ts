import axios from 'axios';
import FormData from 'form-data';
import { env } from '../config/env';
import type { AssignAgentResponse, AvailableAgent } from './types';

// A hung Qiscus response (connection open, no reply) would otherwise block
// axios forever. getAvailableAgents/assignAgent run inside the allocation
// advisory lock, so an unbounded wait there stalls the *entire* queue, not
// just one room. Kept comfortably under the transaction `timeout` (30s) in
// allocate.ts so a slow Qiscus call fails on its own terms instead of
// surfacing as a confusing "transaction already closed" error.
export const QISCUS_API_TIMEOUT_MS = 15000;

function adminServiceHeaders() {
  return {
    'Qiscus-App-Id': env.qiscusAppId,
    'Qiscus-Secret-Key': env.qiscusSecretKey,
  };
}

export async function getAvailableAgents(roomId: string): Promise<AvailableAgent[]> {
  const response = await axios.get(`${env.qiscusBaseUrl}/api/v2/admin/service/available_agents`, {
    headers: adminServiceHeaders(),
    params: { room_id: roomId },
    timeout: QISCUS_API_TIMEOUT_MS,
  });
  return response.data.data.agents as AvailableAgent[];
}

export async function assignAgent(roomId: string, agentId: number): Promise<AssignAgentResponse> {
  const response = await axios.post(
    `${env.qiscusBaseUrl}/api/v1/admin/service/assign_agent`,
    new URLSearchParams({ room_id: roomId, agent_id: String(agentId), replace_latest_agent: 'true' }),
    { headers: adminServiceHeaders(), timeout: QISCUS_API_TIMEOUT_MS },
  );
  return response.data as AssignAgentResponse;
}

export async function loginAdmin(email: string, password: string): Promise<string> {
  const form = new FormData();
  form.append('email', email);
  form.append('password', password);

  const response = await axios.post(`${env.qiscusBaseUrl}/api/v1/auth`, form, {
    headers: form.getHeaders(),
    timeout: QISCUS_API_TIMEOUT_MS,
  });
  return response.data.data.user.authentication_token as string;
}

export async function setMarkAsResolvedWebhook(
  adminToken: string,
  webhookUrl: string,
  isEnabled: boolean,
): Promise<void> {
  const form = new FormData();
  form.append('webhook_url', webhookUrl);
  form.append('is_webhook_enabled', String(isEnabled));

  await axios.post(`${env.qiscusBaseUrl}/api/v1/app/webhook/mark_as_resolved`, form, {
    headers: {
      ...form.getHeaders(),
      Authorization: adminToken,
      'Qiscus-App-Id': env.qiscusAppId,
    },
    timeout: QISCUS_API_TIMEOUT_MS,
  });
}
