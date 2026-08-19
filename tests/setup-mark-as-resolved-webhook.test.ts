import { describe, expect, it } from 'vitest';
import nock from 'nock';
import { env } from '../src/config/env';
import { registerMarkAsResolvedWebhook } from '../scripts/setup-mark-as-resolved-webhook';

describe('registerMarkAsResolvedWebhook', () => {
  it('logs in as admin then registers the webhook url', async () => {
    nock(env.qiscusBaseUrl)
      .post('/api/v1/auth')
      .reply(200, { data: { user: { authentication_token: 'token-abc' } } });

    const registerScope = nock(env.qiscusBaseUrl)
      .post('/api/v1/app/webhook/mark_as_resolved')
      .reply(200, { data: { id: 1 } });

    await registerMarkAsResolvedWebhook('https://example.com/webhooks/mark-as-resolved');

    expect(registerScope.isDone()).toBe(true);
  });
});
