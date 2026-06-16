<script setup lang="ts">
import type { CommandTaskSummary } from '@/utils/tools/shell'
import { Check, Terminal, X } from 'lucide-vue-next'
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { commandTasks, stopManagedCommandTask } from '@/utils/tools/shell'

const emit = defineEmits<{
  close: []
}>()

const popupPos = ref({ x: 0, y: 0 })

function updatePos() {
  const btn = document.querySelector('.extender-bg-btn')
  if (btn) {
    const rect = btn.getBoundingClientRect()
    popupPos.value = {
      x: Math.round(rect.left + rect.width / 2),
      y: Math.round(rect.top - 8),
    }
  }
}

onMounted(() => {
  updatePos()
  window.addEventListener('resize', updatePos)
})

onUnmounted(() => {
  window.removeEventListener('resize', updatePos)
})

const tasks = computed(() => commandTasks.value)

function elapsed(ms: number): string {
  const s = Math.floor((Date.now() - ms) / 1000)
  if (s < 60)
    return `${s}s`
  const m = Math.floor(s / 60)
  return `${m}m ${s % 60}s`
}

async function killTask(id: string) {
  await stopManagedCommandTask(id)
}

function statusColor(status: CommandTaskSummary['status']) {
  switch (status) {
    case 'running': return 'var(--color-accent-text)'
    case 'completed': return 'var(--color-success-text)'
    case 'failed':
    case 'killed':
    case 'timed_out': return 'var(--color-danger-text)'
    default: return 'var(--color-text-tertiary)'
  }
}
</script>

<template>
  <Teleport to="body">
    <Transition name="fade" appear>
      <div class="bg-backdrop" @click="emit('close')" />
    </Transition>

    <Transition name="popup" appear>
      <div
        class="bg-popup"
        :style="{ left: `${popupPos.x}px`, top: `${popupPos.y}px` }"
      >
        <div class="bg-header">
          <Terminal :size="14" :stroke-width="2" />
          <span>Background Commands</span>
        </div>

        <div v-if="tasks.length === 0" class="bg-empty">
          <p>No background commands</p>
        </div>

        <div v-else class="bg-list">
          <div
            v-for="task in tasks"
            :key="task.id"
            class="bg-card"
          >
            <div class="bg-card-info">
              <div class="bg-card-status" :style="{ background: statusColor(task.status) }" />
              <div class="bg-card-text">
                <span class="bg-card-summary">{{ task.summary }}</span>
                <span class="bg-card-meta">
                  <template v-if="task.status === 'running'">
                    {{ task.completedCommands }}/{{ task.commandCount }} commands · {{ elapsed(task.startedAt) }}
                  </template>
                  <template v-else-if="task.status === 'completed'">
                    Done{{ task.exitCode != null && task.exitCode !== 0 ? ` · exit ${task.exitCode}` : '' }}
                  </template>
                  <template v-else>
                    {{ task.status }}{{ task.exitCode != null ? ` · exit ${task.exitCode}` : '' }}
                  </template>
                </span>
              </div>
            </div>

            <button
              v-if="task.status === 'running'"
              class="bg-card-kill"
              aria-label="Stop command"
              @click="killTask(task.id)"
            >
              <X :size="14" :stroke-width="2" />
            </button>
            <Check v-else-if="task.status === 'completed'" :size="14" :stroke-width="2" class="bg-card-done" />
            <X v-else :size="14" :stroke-width="2" class="bg-card-done bg-card-done--error" />
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.bg-backdrop {
  position: fixed;
  inset: 0;
  background: transparent;
  z-index: 9998;
}

.bg-popup {
  position: fixed;
  transform: translate(-50%, -100%);
  width: min(320px, calc(100vw - 40px));
  max-height: min(360px, 60vh);
  display: flex;
  flex-direction: column;
  background: var(--color-bg-elevated);
  border: 1px solid var(--color-border-bright);
  border-radius: var(--radius-lg);
  box-shadow: var(--color-shadow-floating);
  overflow: hidden;
  z-index: 9999;
}

.bg-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 14px;
  font-size: 12px;
  font-weight: 600;
  color: var(--color-text-secondary);
  border-bottom: 1px solid var(--color-border-mid);
  flex-shrink: 0;
}

.bg-empty {
  padding: 24px 16px;
  text-align: center;
}

.bg-empty p {
  margin: 0;
  font-size: 12px;
  color: var(--color-text-tertiary);
}

.bg-list {
  display: flex;
  flex-direction: column;
  overflow-y: auto;
  padding: 6px;
  gap: 4px;
}

.bg-card {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 10px 12px;
  background: var(--color-bg-surface);
  border: 1px solid var(--color-border-subtle);
  border-radius: var(--radius-lg);
  min-height: 44px;
}

.bg-card-info {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
  flex: 1;
}

.bg-card-status {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex-shrink: 0;
}

.bg-card-text {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.bg-card-summary {
  font-size: 13px;
  font-weight: 500;
  color: var(--color-text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.bg-card-meta {
  font-size: 11px;
  color: var(--color-text-tertiary);
}

.bg-card-kill {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  border-radius: var(--radius-md);
  border: 1px solid var(--color-border-mid);
  background: transparent;
  color: var(--color-text-tertiary);
  cursor: pointer;
  flex-shrink: 0;
  transition: all 100ms ease;
}

.bg-card-kill:hover {
  background: color-mix(in srgb, var(--color-danger-muted) 20%, transparent);
  border-color: var(--color-danger-text);
  color: var(--color-danger-text);
}

.bg-card-done {
  color: var(--color-success-text);
  flex-shrink: 0;
}

.bg-card-done--error {
  color: var(--color-danger-text);
}

/* ── Transitions ────────────────────────────────────────────────────────── */
.popup-enter-active {
  transition:
    opacity 150ms cubic-bezier(0.16, 1, 0.3, 1),
    transform 150ms cubic-bezier(0.16, 1, 0.3, 1);
}
.popup-leave-active {
  transition:
    opacity 100ms cubic-bezier(0.7, 0, 0.84, 0),
    transform 100ms cubic-bezier(0.7, 0, 0.84, 0);
}
.popup-enter-from,
.popup-leave-to {
  opacity: 0;
  transform: translate(-50%, calc(-100% + 8px)) scale(0.96);
}
.popup-enter-to,
.popup-leave-from {
  opacity: 1;
  transform: translate(-50%, -100%) scale(1);
}

.fade-enter-active {
  transition: opacity 150ms cubic-bezier(0.16, 1, 0.3, 1);
}
.fade-leave-active {
  transition: opacity 100ms cubic-bezier(0.7, 0, 0.84, 0);
}
.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}
</style>
