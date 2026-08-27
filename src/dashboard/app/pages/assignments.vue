<template>
  <div class="flex flex-col gap-6">
    <div>
      <h1 class="text-2xl font-bold text-gray-900">Assignments</h1>
      <p class="text-gray-500">Riwayat room: waiting, assigned, resolved.</p>
    </div>

    <div class="flex flex-wrap gap-2">
      <button
        v-for="chip in statusChips"
        :key="chip.value"
        type="button"
        class="rounded-full border px-3 py-1.5 text-sm font-medium transition-colors"
        :class="
          status === chip.value
            ? 'border-primary-500 bg-primary-50 text-primary-700'
            : 'border-gray-200 text-gray-600 hover:bg-gray-50'
        "
        @click="status = chip.value"
      >
        {{ chip.label }} ({{ chip.count }})
      </button>
    </div>

    <div class="flex flex-wrap gap-2">
      <USelect v-model="agentId" :items="agentOptions" placeholder="Agent" class="w-48" />
      <UInput v-model="roomId" placeholder="Cari Room ID" class="w-48" />
    </div>

    <UAlert v-if="error" color="error" title="Gagal memuat data" :description="error.message" />

    <UCard v-else>
      <table class="w-full text-sm">
        <thead>
          <tr class="border-b border-gray-200 text-left text-xs uppercase tracking-wide text-gray-500">
            <th class="py-2 pr-4">Room ID</th>
            <th class="py-2 pr-4">Agent</th>
            <th class="py-2 pr-4">Status</th>
            <th class="py-2 pr-4">Dibuat</th>
            <th class="py-2 pr-4">Wait</th>
            <th class="py-2">Handle</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in result?.data" :key="row.id" class="border-b border-gray-100 last:border-0">
            <td class="py-3 pr-4 font-mono">{{ row.roomId }}</td>
            <td class="py-3 pr-4">{{ row.agent?.name ?? '—' }}</td>
            <td class="py-3 pr-4">
              <UBadge :color="statusColor(row.status)" variant="soft">{{ row.status }}</UBadge>
            </td>
            <td class="py-3 pr-4 tabular-nums text-gray-500">{{ formatTime(row.createdAt) }}</td>
            <td class="py-3 pr-4 tabular-nums text-gray-500">
              {{ row.waitTimeMs !== null ? formatDuration(row.waitTimeMs) : '—' }}
            </td>
            <td class="py-3 tabular-nums text-gray-500">
              {{ row.handleTimeMs !== null ? formatDuration(row.handleTimeMs) : '—' }}
            </td>
          </tr>
          <tr v-if="result && result.data.length === 0">
            <td colspan="6" class="py-6 text-center text-gray-400">Gak ada assignment yang cocok filter ini.</td>
          </tr>
        </tbody>
      </table>

      <div class="mt-4 flex items-center justify-between border-t border-gray-100 pt-4 text-sm text-gray-500">
        <span>Menampilkan {{ rangeLabel }} dari {{ result?.total ?? 0 }}</span>
        <div class="flex gap-2">
          <UButton size="xs" variant="outline" :disabled="page <= 1" @click="page--">« Prev</UButton>
          <UButton size="xs" variant="outline" :disabled="!hasNextPage" @click="page++">Next »</UButton>
        </div>
      </div>
    </UCard>
  </div>
</template>

<script lang="ts" setup>
interface AssignmentRow {
  id: number;
  roomId: string;
  status: 'waiting' | 'assigned' | 'resolved';
  agent: { id: number; name: string } | null;
  createdAt: string;
  assignedAt: string | null;
  resolvedAt: string | null;
  waitTimeMs: number | null;
  handleTimeMs: number | null;
}
interface AssignmentsResponse {
  data: AssignmentRow[];
  page: number;
  pageSize: number;
  total: number;
  counts: { all: number; waiting: number; assigned: number; resolved: number };
}
interface AgentRow {
  id: number;
  name: string;
}

const status = ref('');
const agentId = ref('');
const roomId = ref('');
const page = ref(1);

watch([status, agentId, roomId], () => {
  page.value = 1;
});

const { data: agents } = await useFetch<AgentRow[]>('/api/agents');
const agentOptions = computed(() => [
  { label: 'Semua agent', value: '' },
  ...(agents.value ?? []).map((a) => ({ label: a.name, value: String(a.id) })),
]);

const query = computed(() => ({
  status: status.value || undefined,
  agentId: agentId.value || undefined,
  roomId: roomId.value || undefined,
  page: page.value,
}));

const { data: result, error } = await useFetch<AssignmentsResponse>('/api/assignments', { query, watch: [query] });

const statusChips = computed(() => [
  { label: 'Semua', value: '', count: result.value?.counts.all ?? 0 },
  { label: 'Waiting', value: 'waiting', count: result.value?.counts.waiting ?? 0 },
  { label: 'Assigned', value: 'assigned', count: result.value?.counts.assigned ?? 0 },
  { label: 'Resolved', value: 'resolved', count: result.value?.counts.resolved ?? 0 },
]);

const hasNextPage = computed(() => {
  if (!result.value) return false;
  return result.value.page * result.value.pageSize < result.value.total;
});

const rangeLabel = computed(() => {
  if (!result.value || result.value.total === 0) return '0';
  const start = (result.value.page - 1) * result.value.pageSize + 1;
  const end = Math.min(result.value.page * result.value.pageSize, result.value.total);
  return `${start}–${end}`;
});

function statusColor(s: AssignmentRow['status']) {
  if (s === 'waiting') return 'warning';
  if (s === 'resolved') return 'primary';
  return 'neutral';
}

function formatTime(iso: string) {
  return new Date(iso).toLocaleString('id-ID', {
    dateStyle: 'short',
    timeStyle: 'medium',
    timeZone: 'Asia/Jakarta',
  });
}
</script>
