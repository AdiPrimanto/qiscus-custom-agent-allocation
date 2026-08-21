import { afterEach, describe, expect, it, vi } from 'vitest';
import axios from 'axios';
import nock from 'nock';
import { env } from '../src/config/env';
import {
  assignAgent,
  getAvailableAgents,
  loginAdmin,
  QISCUS_API_TIMEOUT_MS,
  setMarkAsResolvedWebhook,
} from '../src/qiscus/client';

describe('qiscus client', () => {
  it('fetches available agents for a room', async () => {
    nock(env.qiscusBaseUrl)
      .get('/api/v2/admin/service/available_agents')
      .query({ room_id: 'room-1' })
      .matchHeader('Qiscus-App-Id', env.qiscusAppId)
      .matchHeader('Qiscus-Secret-Key', env.qiscusSecretKey)
      .reply(200, {
        data: {
          agents: [
            {
              id: 1,
              name: 'Dewi',
              email: 'dewi@mail.com',
              type: 2,
              type_as_string: 'agent',
              is_available: true,
              current_customer_count: 1,
            },
          ],
        },
      });

    const agents = await getAvailableAgents('room-1');

    expect(agents).toHaveLength(1);
    expect(agents[0].is_available).toBe(true);
  });

  it('assigns an agent to a room', async () => {
    nock(env.qiscusBaseUrl)
      .post('/api/v1/admin/service/assign_agent', 'room_id=room-1&agent_id=1&replace_latest_agent=true')
      .matchHeader('Qiscus-App-Id', env.qiscusAppId)
      .matchHeader('Qiscus-Secret-Key', env.qiscusSecretKey)
      .reply(200, {
        data: { added_agent: { id: 1, name: 'Dewi', email: 'dewi@mail.com', is_available: true } },
      });

    const result = await assignAgent('room-1', 1);

    expect(result.data.added_agent.id).toBe(1);
  });

  it('logs in as admin and returns the authentication token', async () => {
    nock(env.qiscusBaseUrl)
      .post('/api/v1/auth')
      .matchHeader('content-type', /^multipart\/form-data/)
      .reply(200, { data: { user: { authentication_token: 'token-123' } } });

    const token = await loginAdmin('admin@example.com', 'secret');

    expect(token).toBe('token-123');
  });

  it('registers the mark as resolved webhook', async () => {
    nock(env.qiscusBaseUrl)
      .post('/api/v1/app/webhook/mark_as_resolved')
      .matchHeader('authorization', 'token-123')
      .matchHeader('Qiscus-App-Id', env.qiscusAppId)
      .matchHeader('content-type', /^multipart\/form-data/)
      .reply(200, { data: { id: 1 } });

    await expect(
      setMarkAsResolvedWebhook('token-123', 'https://example.com/webhooks/mark-as-resolved', true),
    ).resolves.toBeUndefined();
  });

  describe('request timeout', () => {
    afterEach(() => {
      vi.restoreAllMocks();
    });

    // A hung Qiscus response (not an error - just never replies) holds the
    // global allocation lock open for as long as axios is willing to wait.
    // With no timeout, that's indefinite. Verified via a spy rather than an
    // actual slow nock delay so this stays fast instead of taking 15s+ to run.
    it('sets a timeout on getAvailableAgents so a hung response cannot block the allocation lock forever', async () => {
      const getSpy = vi.spyOn(axios, 'get').mockResolvedValueOnce({ data: { data: { agents: [] } } });

      await getAvailableAgents('room-1');

      expect(getSpy).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ timeout: QISCUS_API_TIMEOUT_MS }),
      );
    });

    it('sets a timeout on assignAgent', async () => {
      const postSpy = vi
        .spyOn(axios, 'post')
        .mockResolvedValueOnce({ data: { data: { added_agent: {} } } });

      await assignAgent('room-1', 1);

      expect(postSpy).toHaveBeenCalledWith(
        expect.any(String),
        expect.anything(),
        expect.objectContaining({ timeout: QISCUS_API_TIMEOUT_MS }),
      );
    });
  });
});
