import { env } from '../src/config/env';
import { loginAdmin, setMarkAsResolvedWebhook } from '../src/qiscus/client';

export async function registerMarkAsResolvedWebhook(webhookUrl: string): Promise<void> {
  if (!env.qiscusAdminEmail || !env.qiscusAdminPassword) {
    throw new Error('QISCUS_ADMIN_EMAIL and QISCUS_ADMIN_PASSWORD must be set to run this script');
  }

  const token = await loginAdmin(env.qiscusAdminEmail, env.qiscusAdminPassword);
  await setMarkAsResolvedWebhook(token, webhookUrl, true);
}

if (require.main === module) {
  const webhookUrl = process.argv[2];
  if (!webhookUrl) {
    console.error('Usage: npm run setup:webhook -- <https://your-deployed-url>/webhooks/mark-as-resolved');
    process.exit(1);
  }

  registerMarkAsResolvedWebhook(webhookUrl)
    .then(() => console.log(`Mark As Resolved webhook registered: ${webhookUrl}`))
    .catch((error) => {
      console.error('Failed to register webhook', error);
      process.exit(1);
    });
}
