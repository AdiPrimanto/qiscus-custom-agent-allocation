import { describe, expect, it } from 'vitest';
import { loadEnv } from '../src/config/env';

describe('loadEnv', () => {
  it('parses required and optional values with defaults', () => {
    const result = loadEnv({
      QISCUS_APP_ID: 'app-1',
      QISCUS_SECRET_KEY: 'secret-1',
    } as NodeJS.ProcessEnv);

    expect(result.qiscusAppId).toBe('app-1');
    expect(result.qiscusSecretKey).toBe('secret-1');
    expect(result.qiscusBaseUrl).toBe('https://multichannel.qiscus.com');
    expect(result.maxConcurrentDefault).toBe(2);
    expect(result.reconciliationIntervalMs).toBe(20000);
    expect(result.port).toBe(3000);
  });

  it('throws when QISCUS_APP_ID is missing', () => {
    expect(() =>
      loadEnv({ QISCUS_SECRET_KEY: 'secret-1' } as NodeJS.ProcessEnv),
    ).toThrow('Missing required environment variable: QISCUS_APP_ID');
  });
});
