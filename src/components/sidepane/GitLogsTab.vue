<script setup lang="ts">
import { ChevronDown, ChevronRight, ScrollText, Trash2 } from 'lucide-vue-next'
import { computed, nextTick, reactive, ref, watch } from 'vue'
import { useGitLogsStore } from '@/stores/gitLogs'

const props = defineProps<{
  tabId: string
  cwd: string
}>()

const store = useGitLogsStore()

const logs = computed(() => store.logsByTab[props.tabId] ?? [])

const scrollEl = ref<HTMLElement | null>(null)
const expanded = reactive(new Set<string>())

function formatTimestamp(ts: number): string {
  const d = new Date(ts)
  const pad = (n: number, w = 2): string => String(n).padStart(w, '0')
  const yyyy = d.getFullYear()
  const mm = pad(d.getMonth() + 1)
  const dd = pad(d.getDate())
  const hh = pad(d.getHours())
  const mi = pad(d.getMinutes())
  const ss = pad(d.getSeconds())
  const ms = pad(d.getMilliseconds(), 3)
  return `${yyyy}-${mm}-${dd} ${hh}:${mi}:${ss}.${ms}`
}

function toggleLine(id: string): void {
  if (expanded.has(id))
    expanded.delete(id)
  else
    expanded.add(id)
}

function clearLogs(): void {
  expanded.clear()
  store.clear(props.tabId)
}

watch(
  () => logs.value.length,
  () => {
    nextTick(() => {
      if (scrollEl.value)
        scrollEl.value.scrollTop = scrollEl.value.scrollHeight
    })
  },
)
</script>

<template>
  <div class="flex flex-col flex-1 min-h-0 bg-[var(--color-bg-base)]">
    <div class="flex items-center justify-between gap-2 px-2.5 py-1.5 border-b border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)] shrink-0">
      <div class="flex items-center gap-1.5 min-w-0 flex-1">
        <ScrollText :size="12" class="shrink-0 text-[var(--color-text-dim)]" />
        <span class="min-w-0 flex-1 truncate text-[11px] leading-none text-[var(--color-text-dim)] font-mono" :title="props.cwd">{{ props.cwd }}</span>
        <span class="shrink-0 text-[10px] leading-none px-1.5 py-0.5 rounded-full bg-[var(--color-bg-elevated)] border border-[var(--color-border-subtle)] text-[var(--color-text-dim)]">{{ logs.length }}</span>
      </div>
      <button
        v-if="logs.length > 0"
        class="inline-flex items-center gap-1 shrink-0 h-[22px] px-2 rounded-[var(--radius-sm)] border border-[var(--color-border-subtle)] bg-transparent text-[11px] font-medium text-[var(--color-text-dim)] hover:bg-[var(--color-state-hover)] hover:text-[var(--color-text-primary)] transition-colors"
        title="Clear logs for this tab"
        @click="clearLogs"
      >
        <Trash2 :size="11" />
        Clear
      </button>
    </div>
    <div ref="scrollEl" class="flex-1 min-h-0 overflow-y-auto [scrollbar-width:thin] [scrollbar-color:var(--color-border-bright)_transparent] font-mono text-[11px] leading-[1.6] p-2">
      <div v-if="logs.length === 0" class="flex flex-col items-center justify-center gap-2 min-h-[180px] py-8 px-4 text-center">
        <div class="flex items-center justify-center w-[38px] h-[38px] rounded-[var(--radius-lg)] border border-[var(--color-border-subtle)] bg-[var(--color-bg-elevated)] text-[var(--color-text-dim)]">
          <ScrollText :size="18" :stroke-width="1.5" />
        </div>
        <p class="m-0 text-[12.5px] font-medium text-[var(--color-text-secondary)]">
          No git output yet
        </p>
        <p class="m-0 text-[11px] text-[var(--color-text-dim)] max-w-[260px] leading-[1.5]">
          Git commands for this tab will appear here.
        </p>
      </div>

      <div v-else class="flex flex-col gap-1">
        <div
          v-for="line in logs"
          :key="line.id"
          class="flex flex-col rounded-[4px] border border-transparent hover:border-[var(--color-border-subtle)] hover:bg-[var(--color-state-hover)] overflow-hidden"
        >
          <div
            class="flex flex-wrap items-center gap-x-1.5 py-[3px] px-1.5 whitespace-pre-wrap break-all cursor-pointer select-none"
            @click="line.stdout || line.stderr ? toggleLine(line.id) : undefined"
          >
            <ChevronDown v-if="(line.stdout || line.stderr) && expanded.has(line.id)" :size="11" class="shrink-0 text-[var(--color-text-dim)]" />
            <ChevronRight v-else-if="line.stdout || line.stderr" :size="11" class="shrink-0 text-[var(--color-text-dim)]" />
            <span class="text-[var(--color-text-dim)] shrink-0">{{ formatTimestamp(line.timestamp) }}</span>
            <span class="shrink-0 font-semibold" :class="line.exitCode === 0 ? 'text-[var(--color-success)]' : 'text-[var(--color-danger)]'">[{{ line.exitCode === 0 ? 'ok' : line.exitCode === null ? '?' : 'err' }}]</span>
            <span class="text-[var(--color-text-secondary)]">&gt;</span>
            <span class="text-[var(--color-text-primary)]">{{ line.command }}</span>
            <span class="text-[var(--color-text-dim)] shrink-0">[{{ line.durationMs }}ms]</span>
            <span v-if="line.exitCode !== null && line.exitCode !== 0" class="shrink-0 px-1 py-0 rounded text-[10px] leading-none font-semibold bg-[color-mix(in_srgb,var(--color-danger)_15%,transparent)] text-[var(--color-danger)] border border-[color-mix(in_srgb,var(--color-danger)_30%,transparent)]">exit {{ line.exitCode }}</span>
          </div>
          <div v-if="expanded.has(line.id) && (line.stdout || line.stderr)" class="flex flex-col gap-1.5 px-2 pb-2 pt-1 ml-2 border-l-2 border-[var(--color-border-subtle)]">
            <pre v-if="line.stdout" class="m-0 p-2 rounded-[4px] bg-[var(--color-bg-surface)] border border-[var(--color-border-subtle)] text-[var(--color-text-secondary)] whitespace-pre-wrap break-all text-[11px] leading-[1.5] max-h-[200px] overflow-auto [scrollbar-width:thin]">{{ line.stdout }}</pre>
            <pre v-if="line.stderr" class="m-0 p-2 rounded-[4px] bg-[color-mix(in_srgb,var(--color-danger)_8%,transparent)] border border-[color-mix(in_srgb,var(--color-danger)_18%,transparent)] text-[var(--color-danger)] whitespace-pre-wrap break-all text-[11px] leading-[1.5] max-h-[200px] overflow-auto [scrollbar-width:thin]">{{ line.stderr }}</pre>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
