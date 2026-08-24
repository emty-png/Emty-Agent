<script setup lang="ts">
import type { DesignVersionRef } from '@/stores/chat/core/types'
import { GitCompareArrows, RotateCcw, X } from 'lucide-vue-next'
import { ref, watch } from 'vue'
import { useDesignVersionStore } from '@/stores/designVersions'
import { injectConsoleBootstrap, injectPickerBootstrap } from '@/utils/tools/designProject'

const props = defineProps<{
  version: DesignVersionRef | null
}>()

const emit = defineEmits<{
  close: []
  restore: [string]
  compare: [string]
}>()

const srcdoc = ref('')
const dvStore = useDesignVersionStore()

async function buildSrc(files: Record<string, string>) {
  let html = files['index.html'] ?? '<html><body>No snapshot</body></html>'
  html = injectConsoleBootstrap(html)
  html = injectPickerBootstrap(html)
  try {
    const css = files['styles.css']
    if (css !== undefined)
      html = html.replace(/<link\s[^>]*href=["'](?:\.\/)?styles\.css["'][^>]*>/i, `<style>${css.replaceAll('$', '$$$$')}</style>`)
  }
  catch {}
  try {
    const js = files['script.js']
    if (js !== undefined)
      html = html.replace(/<script\s[^>]*src=["'](?:\.\/)?script\.js["'][^>]*>\s*<\/script>/i, `<script>${js.replaceAll('$', '$$$$')}<\/script>`)
  }
  catch {}
  return html
}

watch(() => props.version?.id, async () => {
  if (!props.version) {
    srcdoc.value = ''
    return
  }
  const files = await dvStore.readSnapshotFiles(props.version.id)
  srcdoc.value = await buildSrc(files)
}, { immediate: true })
</script>

<template>
  <Teleport to="body">
    <div v-if="version" class="fixed inset-0 z-[99985] flex flex-col bg-[var(--color-bg-base)]">
      <div class="flex items-center gap-2 px-4 py-2.5 border-b border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)] shrink-0">
        <span class="text-[13px] font-semibold">{{ version.label }}</span>
        <span class="text-[11px] text-[var(--color-text-tertiary)]">{{ new Date(version.createdAt).toLocaleString() }} · {{ version.filesChanged.join(', ') || 'scaffold' }}</span>
        <span class="flex-1" />
        <button class="inline-flex items-center gap-1 h-7 px-2.5 rounded-[var(--radius-sm)] border border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)] text-[11px]" @click="emit('compare', version.id)">
          <GitCompareArrows :size="12" /> Compare
        </button>
        <button class="inline-flex items-center gap-1 h-7 px-3 rounded-[var(--radius-sm)] bg-[var(--color-accent)] text-[var(--color-bg-base)] text-[11px] font-semibold" @click="emit('restore', version.id)">
          <RotateCcw :size="12" /> Restore
        </button>
        <button class="inline-flex items-center justify-center w-7 h-7 rounded-[var(--radius-sm)] hover:bg-[var(--color-state-hover)]" @click="emit('close')">
          <X :size="14" />
        </button>
      </div>
      <iframe class="flex-1 w-full border-0 bg-white" :srcdoc="srcdoc" sandbox="allow-scripts allow-forms allow-same-origin" />
    </div>
  </Teleport>
</template>
