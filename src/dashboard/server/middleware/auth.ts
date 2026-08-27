import { createHash, timingSafeEqual } from 'node:crypto';

// HTTP Basic Auth, single shared password — placeholder until the JWT/iframe
// flow with the Qiscus addon is set up (see design spec section 3.2). Applies
// to every request (pages and /api/*) since this is Nitro server middleware,
// not per-page middleware.
function passwordsMatch(provided: string, expected: string): boolean {
  const providedHash = createHash('sha256').update(provided).digest();
  const expectedHash = createHash('sha256').update(expected).digest();
  return timingSafeEqual(providedHash, expectedHash);
}

export default defineEventHandler((event) => {
  const config = useRuntimeConfig(event);
  const expectedPassword = config.dashboardPassword;

  if (!expectedPassword) {
    throw createError({ statusCode: 500, statusMessage: 'DASHBOARD_PASSWORD not configured' });
  }

  const unauthorized = () => {
    setResponseHeader(event, 'WWW-Authenticate', 'Basic realm="CAA Dashboard"');
    throw createError({ statusCode: 401, statusMessage: 'Unauthorized' });
  };

  const header = getHeader(event, 'authorization');
  if (!header?.startsWith('Basic ')) {
    return unauthorized();
  }

  const decoded = Buffer.from(header.slice('Basic '.length), 'base64').toString('utf-8');
  const separatorIndex = decoded.indexOf(':');
  const password = separatorIndex === -1 ? decoded : decoded.slice(separatorIndex + 1);

  if (!passwordsMatch(password, expectedPassword)) {
    return unauthorized();
  }
});
