<script setup lang="ts">
import type { CommandTaskSummary } from '@/utils/tools/shell'
import { Loader2, Terminal, X } from 'lucide-vue-next'
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { commandTasks, stopManagedCommandTask } from '@/utils/tools/shell'

const props = defineProps<{
  tabId: string
}>()

const ANSI_CLEAR_REGEX = /\u001B\[[0-9;]*[GJKA]/g // eslint-disable-line no-control-regex
const ANSI_COLOR_REGEX = /[\u001B\u009B][[()#;?]*(?:\d{1,4}(?:;\d{0,4})*)?[0-9A-ORZcf-nqry=><]/g // eslint-disable-line no-control-regex

// Normalizes raw PTY output for web display by converting cursor overwrites
// to standard newlines, and stripping ANSI control sequences.
function formatTerminal(str: string): string {
  if (!str)
    return ''
  return str
    .replace(ANSI_CLEAR_REGEX, '\n')
    .replace(ANSI_COLOR_REGEX, '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trimEnd()
}

const tasks = computed(() =>
  commandTasks.value
    .filter(t => t.mode === 'background' && t.tabId === props.tabId)
    .sort((a, b) => a.startedAt - b.startedAt),
)

const scrollEl = ref<HTMLElement | null>(null)

// Pin scroll to bottom as new tasks are spawned.
watch(
  () => tasks.value.length,
  () => {
    nextTick(() => {
      if (scrollEl.value)
        scrollEl.value.scrollTop = scrollEl.value.scrollHeight
    })
  },
)

// 1Hz tick to drive reactive elapsed time counters.
const now = ref(Date.now())
let timer: ReturnType<typeof setInterval> | null = null

onMounted(() => {
  timer = setInterval(() => {
    now.value = Date.now()
  }, 1000)
})

onUnmounted(() => {
  if (timer)
    clearInterval(timer)
})

function elapsed(ms: number): string {
  const s = Math.floor((now.value - ms) / 1000)
  if (s < 60)
    return `${s}s`
  const m = Math.floor(s / 60)
  return `${m}m ${s % 60}s`
}

async function killTask(id: string) {
  await stopManagedCommandTask(id)
}

function getOutput(task: CommandTaskSummary): string {
  const parts: string[] = []
  if (task.stdout)
    parts.push(task.stdout)
  if (task.stderr)
    parts.push(`[stderr]\n${task.stderr}`)

  return formatTerminal(parts.filter(Boolean).join('\n\n'))
}
</script>

<template>
  <div class="relative flex min-h-0 flex-1 flex-col">
    <div class="pointer-events-none absolute left-0 right-0 top-0 z-[5] h-[16px] bg-gradient-to-b from-[var(--color-bg-base)] to-transparent backdrop-blur-[4px] [-webkit-mask-image:linear-gradient(to_bottom,black_0%,transparent_100%)] [mask-image:linear-gradient(to_bottom,black_0%,transparent_100%)]" />

    <div ref="scrollEl" class="flex-1 min-h-0 overflow-y-auto pb-[12px] pl-[12px] pr-[12px] pt-[16px] [scrollbar-color:var(--color-border-bright)_transparent] [scrollbar-width:thin]">
      <div v-if="tasks.length === 0" class="flex min-h-[220px] flex-col items-center justify-center gap-[8px] px-[18px] py-[32px] text-center">
        <div class="flex h-[38px] w-[38px] items-center justify-center rounded-[var(--radius-lg)] border border-[var(--color-border-subtle)] bg-[var(--color-bg-elevated)] text-[var(--color-text-dim)]">
          <Terminal :size="18" :stroke-width="1.8" />
        </div>
        <p class="m-0 text-[13px] font-medium text-[var(--color-text-secondary)]">
          No background tasks
        </p>
        <p class="m-0">
          Commands started with <code>is_background: true</code> will appear here. You can stop them with the kill button.
        </p>
      </div>

      <div v-else class="flex flex-col gap-[12px] pb-[24px]">
        <article
          v-for="task in tasks"
          :key="task.id"
          class="flex flex-col overflow-hidden rounded-[8px] border bg-[var(--color-bg-base)] shadow-[0_1px_3px_rgba(0,0,0,0.05)] [contain:layout_style]"
          :class="[
            task.status === 'running'
              ? 'border-[color-mix(in_srgb,var(--color-accent)_40%,var(--color-border-subtle))]'
              : ['failed', 'killed', 'timed_out'].includes(task.status)
                ? 'border-[color-mix(in_srgb,var(--color-danger)_40%,var(--color-border-subtle))]'
                : 'border-[var(--color-border-subtle)]',
          ]"
        >
          <header class="flex min-h-[38px] items-center justify-between gap-[10px] border-b border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)] px-[12px] py-[8px]">
            <div class="inline-flex items-center gap-[6px] overflow-hidden text-ellipsis whitespace-nowrap text-[12px] font-semibold text-[var(--color-text-primary)]">
              <Terminal :size="12" class="shrink-0 text-[var(--color-text-dim)]" />
              <span class="overflow-hidden text-ellipsis">{{ task.summary }}</span>

              <span class="inline-flex shrink-0 items-center gap-[4px] text-[11px] font-medium text-[var(--color-text-dim)]">
                <template v-if="task.status === 'running'">
                  · <Loader2 :size="10" class="-mt-[1px] animate-spin" /> {{ task.completedCommands }}/{{ task.commandCount }} cmds · {{ elapsed(task.startedAt) }}
                </template>
                <template v-else-if="task.exitCode != null">
                  · exit {{ task.exitCode }}
                </template>
              </span>
            </div>

            <div class="flex items-center gap-[6px]">
              <span
                class="rounded-[4px] px-[6px] py-[1px] text-[10.5px] font-bold uppercase tracking-[0.04em]"
                :class="[
                  task.status === 'running'
                    ? 'bg-[color-mix(in_srgb,var(--color-info)_15%,transparent)] text-[var(--color-info)]'
                    : task.status === 'completed'
                      ? 'bg-[var(--color-success-muted)] text-[var(--color-success)]'
                      : ['failed', 'killed', 'timed_out'].includes(task.status)
                        ? 'bg-[var(--color-danger-muted)] text-[var(--color-danger)]'
                        : '',
                ]"
              >
                {{ task.status }}
              </span>

              <button
                v-if="task.status === 'running'"
                class="flex h-[22px] w-[22px] cursor-pointer items-center justify-center rounded-[var(--radius-sm)] border border-transparent bg-transparent text-[var(--color-danger)] transition-all duration-[150ms] ease-[ease] hover:border-[color-mix(in_srgb,var(--color-danger)_30%,transparent)] hover:bg-[color-mix(in_srgb,var(--color-danger)_15%,transparent)]"
                aria-label="Stop command"
                title="Stop command"
                @click="killTask(task.id)"
              >
                <X :size="14" :stroke-width="2" />
              </button>
            </div>
          </header>

          <pre
            v-if="getOutput(task)"
            class="m-0 max-h-[420px] overflow-auto bg-transparent p-[12px] font-[var(--font-mono)] text-[11.5px] leading-[1.55] text-[var(--color-text-primary)] whitespace-pre [scrollbar-width:thin]"
          ><code>{{ getOutput(task) }}</code></pre>
          <div v-else class="p-[12px] text-[11.5px] italic text-[var(--color-text-dim)]">
            {{ ['completed', 'failed', 'killed', 'timed_out'].includes(task.status) ? 'No output' : 'Waiting for output...' }}
          </div>
        </article>
      </div>
    </div>

    <div class="pointer-events-none absolute bottom-0 left-0 right-0 z-[5] h-[24px] bg-gradient-to-t from-[var(--color-bg-base)] to-transparent backdrop-blur-[4px] [-webkit-mask-image:linear-gradient(to_top,black_0%,transparent_100%)] [mask-image:linear-gradient(to_top,black_0%,transparent_100%)]" />
  </div>
</template>
<!-- Note: Removed the unused <style scoped> block as all styles were extracted to Tailwind. -->
