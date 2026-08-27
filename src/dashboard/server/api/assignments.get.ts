import type { Prisma } from '@prisma/client';
import { prisma } from '../utils/prisma';

const PAGE_SIZE = 20;
const VALID_STATUSES = ['waiting', 'assigned', 'resolved'] as const;

export default defineEventHandler(async (event) => {
  const query = getQuery(event);

  const where: Prisma.AssignmentWhereInput = {};

  if (typeof query.status === 'string' && (VALID_STATUSES as readonly string[]).includes(query.status)) {
    where.status = query.status as (typeof VALID_STATUSES)[number];
  }

  if (typeof query.roomId === 'string' && query.roomId.trim()) {
    where.roomId = { contains: query.roomId.trim() };
  }

  if (typeof query.customer === 'string' && query.customer.trim()) {
    where.customerName = { contains: query.customer.trim(), mode: 'insensitive' };
  }

  const agentId = Number(query.agentId);
  if (query.agentId && Number.isInteger(agentId)) {
    where.agentId = agentId;
  }

  if (typeof query.from === 'string' || typeof query.to === 'string') {
    where.createdAt = {
      ...(typeof query.from === 'string' && !Number.isNaN(Date.parse(query.from))
        ? { gte: new Date(query.from) }
        : {}),
      ...(typeof query.to === 'string' && !Number.isNaN(Date.parse(query.to)) ? { lte: new Date(query.to) } : {}),
    };
  }

  const page = Math.max(1, Number(query.page) || 1);

  // Counts per status ignore the status filter itself (but keep room/agent/date
  // filters) — that's what makes the chips useful for switching status without
  // losing the rest of the filter.
  const { status: _status, ...whereForCounts } = where;

  const [rows, total, statusCounts] = await Promise.all([
    prisma.assignment.findMany({
      where,
      include: { agent: { select: { id: true, name: true } } },
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
    }),
    prisma.assignment.count({ where }),
    prisma.assignment.groupBy({ by: ['status'], where: whereForCounts, _count: { status: true } }),
  ]);

  const countByStatus = Object.fromEntries(statusCounts.map((row) => [row.status, row._count.status]));

  return {
    data: rows.map((row) => ({
      id: row.id,
      roomId: row.roomId,
      customerName: row.customerName,
      status: row.status,
      agent: row.agent ? { id: row.agent.id, name: row.agent.name } : null,
      createdAt: row.createdAt,
      assignedAt: row.assignedAt,
      resolvedAt: row.resolvedAt,
      waitTimeMs: row.assignedAt ? row.assignedAt.getTime() - row.createdAt.getTime() : null,
      handleTimeMs: row.assignedAt && row.resolvedAt ? row.resolvedAt.getTime() - row.assignedAt.getTime() : null,
    })),
    page,
    pageSize: PAGE_SIZE,
    total,
    counts: {
      all: (countByStatus.waiting ?? 0) + (countByStatus.assigned ?? 0) + (countByStatus.resolved ?? 0),
      waiting: countByStatus.waiting ?? 0,
      assigned: countByStatus.assigned ?? 0,
      resolved: countByStatus.resolved ?? 0,
    },
  };
});
