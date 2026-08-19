import axios from 'axios';
import FormData from 'form-data';
import { env } from '../config/env';
import type { AssignAgentResponse, AvailableAgent } from './types';

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
  });
  return response.data.data.agents as AvailableAgent[];
}

export async function assignAgent(roomId: string, agentId: number): Promise<AssignAgentResponse> {
  const response = await axios.post(
    `${env.qiscusBaseUrl}/api/v1/admin/service/assign_agent`,
    new URLSearchParams({ room_id: roomId, agent_id: String(agentId) }),
    { headers: adminServiceHeaders() },
  );
  return response.data as AssignAgentResponse;
}

export async function loginAdmin(email: string, password: string): Promise<string> {
  const form = new FormData();
  form.append('email', email);
  form.append('password', password);

  const response = await axios.post(`${env.qiscusBaseUrl}/api/v1/auth`, form, {
    headers: form.getHeaders(),
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
  });
}
