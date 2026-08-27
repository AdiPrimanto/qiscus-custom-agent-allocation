<template>
  <div class="flex flex-col gap-6">
    <div>
      <h1 class="text-2xl font-bold text-gray-900">Overview</h1>
      <p class="text-gray-500">Kondisi queue &amp; agent saat ini.</p>
    </div>

    <div class="grid grid-cols-2 gap-4 sm:grid-cols-4">
      <UCard>
        <div class="text-2xl font-bold text-gray-900">{{ summary?.totalAgents ?? '—' }}</div>
        <div class="text-xs uppercase tracking-wide text-gray-500">Total Agent</div>
      </UCard>
      <UCard>
        <div class="text-2xl font-bold text-gray-900">{{ summary?.waitingCount ?? '—' }}</div>
        <div class="text-xs uppercase tracking-wide text-gray-500">Room Waiting</div>
      </UCard>
      <UCard>
        <div class="text-2xl font-bold text-gray-900">{{ summary?.assignedCount ?? '—' }}</div>
        <div class="text-xs uppercase tracking-wide text-gray-500">Room Assigned</div>
      </UCard>
      <UCard>
        <div class="text-2xl font-bold text-gray-900">{{ oldestWaitingLabel }}</div>
        <div class="text-xs uppercase tracking-wide text-gray-500">Waiting Tertua</div>
      </UCard>
    </div>

    <div v-if="summary?.alerts?.length" class="flex flex-col gap-2">
      <UAlert
        v-for="(alert, i) in summary.alerts"
        :key="i"
        :color="alert.type === 'waiting-stuck' ? 'warning' : 'error'"
        variant="soft"
        :title="alert.type === 'waiting-stuck' ? 'Waiting' : 'Offline'"
        :description="alert.message"
      />
    </div>

    <UCard v-if="status === 'pending' && !summary">
      <USkeleton class="h-24 w-full" />
    </UCard>
    <UAlert v-else-if="error" color="error" title="Gagal memuat data" :description="error.message" />
  </div>
</template>

<script lang="ts" setup>
interface QueueSummary {
  waitingCount: number;
  assignedCount: number;
  resolvedCount: number;
  oldestWaitingAgeMs: number | null;
  totalAgents: number;
  totalCapacity: number;
  alerts: Array<{ type: 'waiting-stuck' | 'offline-reassign-pending'; message: string }>;
}

const { data: summary, status, error, refresh } = await useFetch<QueueSummary>('/api/queue/summary');

useIntervalFn(() => refresh(), 15_000);

const oldestWaitingLabel = computed(() => {
  const ms = summary.value?.oldestWaitingAgeMs;
  if (ms === null || ms === undefined) return '—';
  const totalSeconds = Math.round(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`;
});
</script>
