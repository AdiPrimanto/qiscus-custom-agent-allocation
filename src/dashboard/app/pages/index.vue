<template>
  <div class="flex flex-col gap-6">
    <div>
      <h1 class="text-2xl font-bold text-gray-900">Overview</h1>
      <p class="text-gray-500">Kondisi queue &amp; agent saat ini.</p>
    </div>

    <div class="grid grid-cols-2 gap-4 sm:grid-cols-4">
      <UCard>
        <div class="text-2xl font-bold text-gray-900 bg-white">{{ summary?.totalAgents ?? '—' }}</div>
        <div class="text-xs uppercase tracking-wide text-gray-500">Total Agent</div>
      </UCard>
      <UCard>
        <div class="text-2xl font-bold text-gray-900 bg-white">{{ summary?.waitingCount ?? '—' }}</div>
        <div class="text-xs uppercase tracking-wide text-gray-500">Room Waiting</div>
      </UCard>
      <UCard>
        <div class="text-2xl font-bold text-gray-900 bg-white">{{ summary?.assignedCount ?? '—' }}</div>
        <div class="text-xs uppercase tracking-wide text-gray-500">Room Assigned</div>
      </UCard>
      <UCard>
        <div class="text-2xl font-bold bg-white" :class="oldestWaitingColorClass">{{ oldestWaitingLabel }}</div>
        <UTooltip :text="waitingTerlamaTooltip">
          <div class="w-fit cursor-help border-b border-dotted border-gray-400 text-xs uppercase tracking-wide text-gray-500">
            Waiting Terlama
          </div>
        </UTooltip>
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

    <div class="mt-4 flex flex-col gap-4 border-t border-gray-100 pt-6">
      <div class="flex items-center justify-between">
        <h2 class="text-lg font-bold text-gray-900">Aktivitas</h2>
        <div class="flex gap-1">
          <button
            v-for="preset in rangePresets"
            :key="preset.value"
            type="button"
            class="rounded-full border px-3 py-1.5 text-sm font-medium transition-colors"
            :class="
              range === preset.value
                ? 'border-primary-500 bg-primary-50 text-primary-700'
                : 'border-gray-200 text-gray-600 hover:bg-gray-50'
            "
            @click="range = preset.value"
          >
            {{ preset.label }}
          </button>
        </div>
      </div>

      <div class="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <UCard>
          <div class="text-2xl font-bold text-gray-900">{{ analytics?.totalChats ?? '—' }}</div>
          <div class="text-xs uppercase tracking-wide text-gray-500">Total Chat</div>
        </UCard>
        <UCard>
          <div class="text-2xl font-bold text-gray-900">{{ avgWaitLabel }}</div>
          <UTooltip text="Rata-rata waktu dari room dibuat sampai dapet agent, di rentang tanggal yang dipilih.">
          <div class="w-fit cursor-help border-b border-dotted border-gray-400 text-xs uppercase tracking-wide text-gray-500">
            Avg Wait
          </div>
        </UTooltip>
        </UCard>
        <UCard>
          <div class="text-2xl font-bold text-gray-900">{{ avgHandleLabel }}</div>
          <UTooltip text="Rata-rata waktu dari agent mulai pegang sampai chat resolved, di rentang tanggal yang dipilih.">
          <div class="w-fit cursor-help border-b border-dotted border-gray-400 text-xs uppercase tracking-wide text-gray-500">
            Avg Handle
          </div>
        </UTooltip>
        </UCard>
      </div>

      <div class="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <UCard>
          <h3 class="mb-3 text-sm font-semibold text-gray-700">Chat masuk</h3>
          <LineChart
            v-if="analytics?.chatPerBucket.length"
            :data="analytics.chatPerBucket"
            :height="220"
            x-axis="bucket"
            :x-formatter="(tick: any, i: any) => analytics?.chatPerBucket[i]?.bucket ?? String(tick)"
            :y-axis="['count']"
            :categories="{ count: { name: 'Chat', color: '#27b198' } }"
          />
          <p v-else class="py-10 text-center text-sm text-gray-400">Gak ada chat di rentang ini.</p>
        </UCard>
        <UCard>
          <h3 class="mb-3 text-sm font-semibold text-gray-700">Volume per agent</h3>
          <BarChart
            v-if="analytics?.volumePerAgent.length"
            :data="analytics.volumePerAgent"
            :height="220"
            x-axis="agentName"
            :x-formatter="(tick: any, i: any) => analytics?.volumePerAgent[i]?.agentName ?? String(tick)"
            :y-axis="['count']"
            :categories="{ count: { name: 'Chat', color: '#27b198' } }"
          />
          <p v-else class="py-10 text-center text-sm text-gray-400">Gak ada chat di rentang ini.</p>
        </UCard>
      </div>
    </div>
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
  waitingStuckThresholdMs: number;
  alerts: Array<{ type: 'waiting-stuck' | 'offline-reassign-pending'; message: string }>;
}

const { data: summary, status, error, refresh } = await useFetch<QueueSummary>('/api/queue/summary');

useIntervalFn(() => refresh(), 15_000);

const oldestWaitingLabel = computed(() => {
  const ms = summary.value?.oldestWaitingAgeMs;
  return ms === null || ms === undefined ? '—' : formatDuration(ms);
});

// Below 80% of the alert threshold: normal. 80%-100%: approaching, so the
// number itself starts signaling before the alert box appears — no more
// silent jump from "nothing shown" straight to a full alert. At/past 100%
// matches the alert's own color.
const oldestWaitingColorClass = computed(() => {
  const ms = summary.value?.oldestWaitingAgeMs;
  const threshold = summary.value?.waitingStuckThresholdMs;
  if (ms === null || ms === undefined || !threshold) return 'text-gray-900';
  const ratio = ms / threshold;
  if (ratio >= 1) return 'text-red-600';
  if (ratio >= 0.8) return 'text-amber-600';
  return 'text-gray-900';
});

const waitingTerlamaTooltip = computed(() => {
  const threshold = summary.value?.waitingStuckThresholdMs;
  const base = 'Umur room waiting yang paling lama nunggu di antrian sekarang.';
  return threshold ? `${base} Alert muncul kalau lebih dari ${formatDuration(threshold)}.` : base;
});

interface AnalyticsSummary {
  totalChats: number;
  avgWaitMs: number | null;
  avgHandleMs: number | null;
  chatPerBucket: Array<{ bucket: string; count: number }>;
  volumePerAgent: Array<{ agentName: string; count: number }>;
}

const rangePresets = [
  { label: 'Hari ini', value: 'today' },
  { label: '7 hari', value: '7d' },
  { label: '30 hari', value: '30d' },
] as const;
const range = ref<'today' | '7d' | '30d'>('today');

const { data: analytics } = await useFetch<AnalyticsSummary>('/api/analytics/summary', {
  query: computed(() => ({ range: range.value })),
  watch: [range],
});

const avgWaitLabel = computed(() =>
  analytics.value?.avgWaitMs != null ? formatDuration(analytics.value.avgWaitMs) : '—',
);
const avgHandleLabel = computed(() =>
  analytics.value?.avgHandleMs != null ? formatDuration(analytics.value.avgHandleMs) : '—',
);
</script>
