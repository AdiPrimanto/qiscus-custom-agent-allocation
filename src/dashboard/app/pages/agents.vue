<template>
  <div class="flex flex-col gap-6">
    <div>
      <h1 class="text-2xl font-bold text-gray-900">Agents</h1>
      <p class="text-gray-500">Kuota (<code class="text-sm">max_concurrent</code>) per agent, edit langsung dari sini.</p>
    </div>

    <UAlert v-if="error" color="error" title="Gagal memuat data" :description="error.message" />

    <UCard v-else>
      <table class="w-full text-sm bg-white">
        <thead>
          <tr class="border-b border-gray-200 text-left text-xs uppercase tracking-wide text-gray-500">
            <th class="py-2 pr-4">Agent</th>
            <th class="py-2 pr-4">
              <UTooltip text="Dicek langsung ke Qiscus tiap siklus reconcile — termasuk agent yang lagi idle (gak pegang chat).">
                <span class="cursor-help border-b border-dotted border-gray-400">Status</span>
              </UTooltip>
            </th>
            <th class="py-2 pr-4">
              <UTooltip text="Chat yang lagi ditangani sekarang / kuota maksimal.">
                <span class="cursor-help border-b border-dotted border-gray-400">Load</span>
              </UTooltip>
            </th>
            <th class="py-2 pr-4">Kuota</th>
            <th class="py-2"></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="agent in agents" :key="agent.id" class="border-b border-gray-100 last:border-0">
            <td class="py-3 pr-4">
              <div class="font-medium text-gray-900">{{ agent.name }}</div>
              <div class="text-xs text-gray-500">{{ agent.email }}</div>
            </td>
            <td class="py-3 pr-4">
              <div class="flex flex-wrap gap-1">
                <UBadge v-if="agent.status === 'offline'" color="error" variant="soft">
                  Offline{{ agent.offlineDurationMs !== null ? ` · ${formatDuration(agent.offlineDurationMs)}` : '' }}
                </UBadge>
                <UBadge v-else color="primary" variant="soft">Active</UBadge>
                <UTooltip
                  v-if="agent.maxConcurrent === 0"
                  text="Kuota 0 — agent ini gak akan dapet chat baru sampai kuotanya dinaikin lagi."
                >
                  <UBadge color="neutral" variant="soft" class="cursor-help">Paused</UBadge>
                </UTooltip>
              </div>
            </td>
            <td class="py-3 pr-4 tabular-nums">{{ agent.currentLoad }} / {{ agent.maxConcurrent }}</td>
            <td class="py-3 pr-4">
              <UInputNumber v-model="drafts[agent.id]" :min="0" :max="100" class="w-24" />
            </td>
            <td class="py-3">
              <UButton
                size="xs"
                :disabled="drafts[agent.id] === agent.maxConcurrent"
                :loading="savingId === agent.id"
                @click="save(agent.id)"
              >
                Simpan
              </UButton>
            </td>
          </tr>
        </tbody>
      </table>
    </UCard>

    <div>
      <h2 class="text-lg font-semibold text-gray-900">Riwayat Aktivitas Agent</h2>
      <p class="text-gray-500 text-sm">
        Perubahan kuota, agent offline/online. "Diubah oleh" self-reported dari Basic Auth, belum diverifikasi per-user.
      </p>
    </div>

    <UAlert v-if="activityError" color="error" title="Gagal memuat riwayat" :description="activityError.message" />

    <UCard v-else>
      <table class="w-full text-sm bg-white">
        <thead>
          <tr class="border-b border-gray-200 text-left text-xs uppercase tracking-wide text-gray-500">
            <th class="py-2 pr-4">Waktu</th>
            <th class="py-2 pr-4">Agent</th>
            <th class="py-2 pr-4">Kejadian</th>
            <th class="py-2">Diubah oleh</th>
          </tr>
        </thead>
        <tbody>
          <tr v-if="!activity?.length">
            <td colspan="4" class="py-4 text-center text-gray-400">Belum ada aktivitas tercatat.</td>
          </tr>
          <tr v-for="entry in activity" :key="entry.id" class="border-b border-gray-100 last:border-0">
            <td class="py-3 pr-4 tabular-nums text-gray-500">{{ formatTime(entry.occurredAt) }}</td>
            <td class="py-3 pr-4 font-medium text-gray-900">{{ entry.agentName }}</td>
            <td class="py-3 pr-4">
              <UBadge v-if="entry.type === 'quota_change'" color="primary" variant="soft">
                Kuota {{ entry.oldValue }} → {{ entry.newValue }}
              </UBadge>
              <UBadge v-else-if="entry.type === 'offline'" color="error" variant="soft">Offline</UBadge>
              <UBadge v-else color="primary" variant="soft">Online</UBadge>
            </td>
            <td class="py-3">{{ entry.changedBy ?? '—' }}</td>
          </tr>
        </tbody>
      </table>
    </UCard>
  </div>
</template>

<script lang="ts" setup>
interface AgentRow {
  id: number;
  qiscusAgentId: number;
  name: string;
  email: string;
  maxConcurrent: number;
  source: 'default' | 'override';
  currentLoad: number;
  status: 'offline' | 'active';
  offlineDurationMs: number | null;
  graceExpired: boolean;
}

interface AgentActivityRow {
  id: number;
  agentId: number;
  agentName: string;
  type: 'quota_change' | 'offline' | 'online';
  oldValue: number | null;
  newValue: number | null;
  changedBy: string | null;
  occurredAt: string;
}

const { data: agents, error, refresh } = await useFetch<AgentRow[]>('/api/agents');
const { data: activity, error: activityError, refresh: refreshActivity } = await useFetch<AgentActivityRow[]>(
  '/api/agents/activity',
);

function formatTime(iso: string) {
  return new Date(iso).toLocaleString('id-ID', {
    dateStyle: 'short',
    timeStyle: 'medium',
    timeZone: 'Asia/Jakarta',
  });
}

const drafts = reactive<Record<number, number>>({});
watch(
  agents,
  (rows) => {
    for (const agent of rows ?? []) {
      if (!(agent.id in drafts)) drafts[agent.id] = agent.maxConcurrent;
    }
  },
  { immediate: true },
);

const savingId = ref<number | null>(null);
const toast = useToast();

async function save(id: number) {
  savingId.value = id;
  try {
    await $fetch(`/api/agents/${id}`, {
      method: 'PATCH',
      body: { maxConcurrent: drafts[id] },
    });
    await Promise.all([refresh(), refreshActivity()]);
    toast.add({ title: 'Kuota disimpan', color: 'primary' });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Gagal simpan kuota';
    toast.add({ title: 'Gagal simpan kuota', description: message, color: 'error' });
  } finally {
    savingId.value = null;
  }
}
</script>
