import { prisma } from '../../utils/prisma';

const DAY_MS = 24 * 60 * 60 * 1000;
const HOURLY_BUCKET_CUTOFF_MS = 36 * 60 * 60 * 1000;

function resolveRange(query: Record<string, unknown>): { from: Date; to: Date } {
  const to = new Date();

  if (typeof query.from === 'string' && !Number.isNaN(Date.parse(query.from))) {
    const from = new Date(query.from);
    const explicitTo =
      typeof query.to === 'string' && !Number.isNaN(Date.parse(query.to)) ? new Date(query.to) : to;
    return { from, to: explicitTo };
  }

  if (query.range === '30d') return { from: new Date(to.getTime() - 30 * DAY_MS), to };
  if (query.range === '7d') return { from: new Date(to.getTime() - 7 * DAY_MS), to };

  // 'today' (default) — start of day in Jakarta, not UTC midnight.
  const todayInJakarta = to.toLocaleDateString('en-CA', { timeZone: 'Asia/Jakarta' });
  return { from: new Date(`${todayInJakarta}T00:00:00+07:00`), to };
}

// Hour-aligned buckets are timezone-safe since WIB is a whole-hour (+7)
// offset — a UTC-hour boundary is also a Jakarta-hour boundary. Day buckets
// are not: they must follow Jakarta's calendar day, not UTC's, or a day
// would visibly split around 07:00 Jakarta time.
function bucketKey(date: Date, granularity: 'hour' | 'day'): string {
  if (granularity === 'hour') {
    return new Date(Math.floor(date.getTime() / 3_600_000) * 3_600_000).toISOString();
  }
  return date.toLocaleDateString('en-CA', { timeZone: 'Asia/Jakarta' });
}

function bucketLabel(key: string, granularity: 'hour' | 'day'): string {
  if (granularity === 'hour') {
    return new Date(key).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Jakarta' });
  }
  return new Date(`${key}T00:00:00+07:00`).toLocaleDateString('id-ID', {
    day: '2-digit',
    month: '2-digit',
    timeZone: 'Asia/Jakarta',
  });
}

export default defineEventHandler(async (event) => {
  const query = getQuery(event);
  const { from, to } = resolveRange(query);
  const granularity: 'hour' | 'day' = to.getTime() - from.getTime() <= HOURLY_BUCKET_CUTOFF_MS ? 'hour' : 'day';

  const rows = await prisma.assignment.findMany({
    where: { createdAt: { gte: from, lte: to } },
    select: {
      createdAt: true,
      assignedAt: true,
      resolvedAt: true,
      agentId: true,
      agent: { select: { name: true } },
    },
  });

  const waitTimes = rows.filter((r) => r.assignedAt).map((r) => r.assignedAt!.getTime() - r.createdAt.getTime());
  const handleTimes = rows
    .filter((r) => r.assignedAt && r.resolvedAt)
    .map((r) => r.resolvedAt!.getTime() - r.assignedAt!.getTime());

  const avg = (values: number[]) => (values.length === 0 ? null : values.reduce((a, b) => a + b, 0) / values.length);

  const bucketCounts = new Map<string, number>();
  for (const row of rows) {
    const key = bucketKey(row.createdAt, granularity);
    bucketCounts.set(key, (bucketCounts.get(key) ?? 0) + 1);
  }
  const chatPerBucket = [...bucketCounts.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, count]) => ({ bucket: bucketLabel(key, granularity), count }));

  const volumeByAgent = new Map<string, number>();
  for (const row of rows) {
    if (!row.agentId || !row.agent) continue;
    volumeByAgent.set(row.agent.name, (volumeByAgent.get(row.agent.name) ?? 0) + 1);
  }
  const volumePerAgent = [...volumeByAgent.entries()]
    .sort(([, a], [, b]) => b - a)
    .map(([agentName, count]) => ({ agentName, count }));

  return {
    from: from.toISOString(),
    to: to.toISOString(),
    totalChats: rows.length,
    avgWaitMs: avg(waitTimes),
    avgHandleMs: avg(handleTimes),
    chatPerBucket,
    volumePerAgent,
  };
});
