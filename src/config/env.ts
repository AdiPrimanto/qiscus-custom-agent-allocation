import dotenv from 'dotenv';

dotenv.config();

export interface AppEnv {
  port: number;
  qiscusBaseUrl: string;
  qiscusAppId: string;
  qiscusSecretKey: string;
  qiscusAdminEmail: string;
  qiscusAdminPassword: string;
  webhookSecret: string;
  maxConcurrentDefault: number;
  reconciliationIntervalMs: number;
}

export function loadEnv(source: NodeJS.ProcessEnv): AppEnv {
  const required = (name: string): string => {
    const value = source[name];
    if (!value) {
      throw new Error(`Missing required environment variable: ${name}`);
    }
    return value;
  };

  return {
    port: Number(source.PORT ?? 3000),
    qiscusBaseUrl: source.QISCUS_BASE_URL ?? 'https://multichannel.qiscus.com',
    qiscusAppId: required('QISCUS_APP_ID'),
    qiscusSecretKey: required('QISCUS_SECRET_KEY'),
    qiscusAdminEmail: source.QISCUS_ADMIN_EMAIL ?? '',
    qiscusAdminPassword: source.QISCUS_ADMIN_PASSWORD ?? '',
    webhookSecret: required('WEBHOOK_SECRET'),
    maxConcurrentDefault: Number(source.MAX_CONCURRENT_DEFAULT ?? 2),
    reconciliationIntervalMs: Number(source.RECONCILIATION_INTERVAL_MS ?? 20000),
  };
}

export const env = loadEnv(process.env);
