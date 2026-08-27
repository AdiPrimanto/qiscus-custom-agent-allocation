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
            <th class="py-2 pr-4">Status</th>
            <th class="py-2 pr-4">Load</th>
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
              <UBadge v-if="agent.status === 'offline'" color="error" variant="soft">
                Offline{{ agent.offlineDurationMs !== null ? ` · ${formatDuration(agent.offlineDurationMs)}` : '' }}
              </UBadge>
              <UBadge v-else color="primary" variant="soft">Active</UBadge>
            </td>
            <td class="py-3 pr-4 tabular-nums">{{ agent.currentLoad }} / {{ agent.maxConcurrent }}</td>
            <td class="py-3 pr-4">
              <UInputNumber v-model="drafts[agent.id]" :min="1" :max="100" class="w-24" />
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
  </div>
</template>

<script lang="ts" setup>
interface AgentRow {
  id: number;
  qiscusAgentId: number;
  name: string;
  email: string;
  maxConcurrent: number;
  currentLoad: number;
  status: 'offline' | 'active';
  offlineDurationMs: number | null;
  graceExpired: boolean;
}

const { data: agents, error, refresh } = await useFetch<AgentRow[]>('/api/agents');

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
    await refresh();
    toast.add({ title: 'Kuota disimpan', color: 'primary' });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Gagal simpan kuota';
    toast.add({ title: 'Gagal simpan kuota', description: message, color: 'error' });
  } finally {
    savingId.value = null;
  }
}
</script>
