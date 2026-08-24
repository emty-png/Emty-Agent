<script setup lang="ts">
import type { DesignVersionRef } from '@/stores/chat/core/types'
import { join } from '@tauri-apps/api/path'
import { readTextFile } from '@tauri-apps/plugin-fs'
import { GitCompareArrows, RotateCcw, X } from 'lucide-vue-next'
import { computed, ref, watch } from 'vue'
import { useChatStore } from '@/stores/chat'
import { useDesignVersionStore } from '@/stores/designVersions'
import { injectConsoleBootstrap, injectPickerBootstrap } from '@/utils/tools/designProject'

const props = defineProps<{
  aId: string | null
  bId: string | null // b = live if null
  projectPath: string | null
}>()

const emit = defineEmits<{
  close: []
  restore: [string]
}>()

const dvStore = useDesignVersionStore()
const chat = useChatStore()

const aSrc = ref('')
const bSrc = ref('')
const aLabel = ref('')
const bLabel = ref('Live')
const codeTab = ref<'preview' | 'code'>('preview')
const selectedFile = ref<'index.html' | 'styles.css' | 'script.js'>('index.html')
const aCode = ref('')
const bCode = ref('')

async function buildSrcdoc(files: Record<string, string>): Promise<string> {
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

async function load() {
  if (!props.aId)
    return
  const aFiles = await dvStore.readSnapshotFiles(props.aId)
  aSrc.value = await buildSrcdoc(aFiles)
  aCode.value = aFiles[selectedFile.value] ?? ''
  const aVer = dvStore.versionsByConversation[chat.activeTab.conversationId ?? '']?.find(v => v.id === props.aId) ?? dvStore.getByMessageId(props.aId) as DesignVersionRef | undefined
  aLabel.value = aVer?.label ?? props.aId

  if (props.bId) {
    const bFiles = await dvStore.readSnapshotFiles(props.bId)
    bSrc.value = await buildSrcdoc(bFiles)
    bCode.value = bFiles[selectedFile.value] ?? ''
    const bVer = dvStore.versionsByConversation[chat.activeTab.conversationId ?? '']?.find(v => v.id === props.bId)
    bLabel.value = bVer?.label ?? props.bId
  }
  else if (props.projectPath) {
    const live: Record<string, string> = {}
    for (const f of ['index.html', 'styles.css', 'script.js'] as const) {
      try { live[f] = await readTextFile(await join(props.projectPath, f)) }
      catch {}
    }
    bSrc.value = await buildSrcdoc(live)
    bCode.value = live[selectedFile.value] ?? ''
    bLabel.value = 'Live'
  }
}

watch(() => [props.aId, props.bId, props.projectPath, selectedFile.value], () => { void load() }, { immediate: true })

interface DiffRow {
  type: 'ctx' | 'add' | 'del'
  oldLine: string
  newLine: string
  text: string
}

const MAX_DIFF_ROWS = 800

const diffRows = computed<DiffRow[]>(() => {
  const a = aCode.value
  const b = bCode.value
  if (a === b)
    return []
  const aLines = a.split('\n')
  const bLines = b.split('\n')
  const max = Math.max(aLines.length, bLines.length)
  const out: DiffRow[] = []
  for (let i = 0; i < max; i++) {
    const av = aLines[i]
    const bv = bLines[i]
    if (av === bv) {
      out.push({ type: 'ctx', oldLine: String(i + 1), newLine: String(i + 1), text: av ?? '' })
      continue
    }
    if (av !== undefined)
      out.push({ type: 'del', oldLine: String(i + 1), newLine: '', text: av })
    if (bv !== undefined)
      out.push({ type: 'add', oldLine: '', newLine: String(i + 1), text: bv })
    if (out.length >= MAX_DIFF_ROWS)
      break
  }
  return out
})

const diffTruncated = computed(() => diffRows.value.length >= MAX_DIFF_ROWS)
</script>

<template>
  <Teleport to="body">
    <div class="fixed inset-0 z-[99990] flex flex-col bg-bg-base">
      <div class="flex shrink-0 items-center gap-2 border-b border-border-subtle bg-bg-base px-2.5 py-1.5">
        <GitCompareArrows :size="14" class="text-accent" />
        <span class="text-[13px] font-semibold text-text-primary">Compare</span>
        <span class="text-[12px] text-text-tertiary">{{ aLabel }} ↔ {{ bLabel }}</span>
        <span class="flex-1" />

        <div class="flex items-center gap-1 rounded-sm border border-border-subtle bg-bg-card p-0.5">
          <button
            class="cursor-pointer rounded-sm border-none px-2.5 py-1 text-[11px] font-medium transition-colors duration-150"
            :class="codeTab === 'preview' ? 'bg-accent-muted text-accent-text' : 'bg-transparent text-text-tertiary hover:bg-bg-hover hover:text-text-secondary'"
            @click="codeTab = 'preview'"
          >
            Preview
          </button>
          <button
            class="cursor-pointer rounded-sm border-none px-2.5 py-1 text-[11px] font-medium transition-colors duration-150"
            :class="codeTab === 'code' ? 'bg-accent-muted text-accent-text' : 'bg-transparent text-text-tertiary hover:bg-bg-hover hover:text-text-secondary'"
            @click="codeTab = 'code'"
          >
            Code diff
          </button>
        </div>

        <div v-if="codeTab === 'code'" class="ml-2 flex items-center gap-1">
          <button
            v-for="f in (['index.html', 'styles.css', 'script.js'] as const)"
            :key="f"
            class="cursor-pointer rounded-sm border px-2 py-1 text-[11px] transition-colors duration-150"
            :class="selectedFile === f
              ? 'border-accent-dim bg-accent-muted text-accent-text'
              : 'border-border-subtle bg-transparent text-text-tertiary hover:bg-bg-hover hover:text-text-secondary'"
            @click="selectedFile = f"
          >
            {{ f }}
          </button>
        </div>

        <button
          class="ml-2 inline-flex h-7 cursor-pointer items-center gap-1 rounded-sm border-none bg-accent px-3 text-[11px] font-semibold text-bg-base transition-opacity duration-150 hover:opacity-90 active:scale-[0.97]"
          @click="aId && emit('restore', aId)"
        >
          <RotateCcw :size="12" /> Restore {{ aLabel }}
        </button>
        <button
          class="inline-flex h-[26px] w-[26px] cursor-pointer items-center justify-center rounded-sm border-none bg-transparent text-text-tertiary transition-colors duration-150 hover:bg-bg-hover hover:text-text-secondary active:bg-accent-muted active:text-accent-text"
          title="Close compare"
          @click="emit('close')"
        >
          <X :size="14" :stroke-width="2" />
        </button>
      </div>

      <div v-if="codeTab === 'preview'" class="grid min-h-0 flex-1 grid-cols-2 gap-0">
        <div class="flex min-w-0 flex-col border-r border-border-subtle">
          <div class="border-b border-border-subtle bg-bg-surface px-3 py-1.5 text-[11px] font-semibold text-text-secondary">
            {{ aLabel }}
          </div>
          <iframe class="w-full flex-1 border-0 bg-white" :srcdoc="aSrc" sandbox="allow-scripts allow-forms allow-same-origin" />
        </div>
        <div class="flex min-w-0 flex-col">
          <div class="border-b border-border-subtle bg-bg-surface px-3 py-1.5 text-[11px] font-semibold text-text-secondary">
            {{ bLabel }}
          </div>
          <iframe class="w-full flex-1 border-0 bg-white" :srcdoc="bSrc" sandbox="allow-scripts allow-forms allow-same-origin" />
        </div>
      </div>

      <div v-else class="min-h-0 flex-1 overflow-auto bg-bg-base [scrollbar-width:thin] [scrollbar-color:var(--color-border-bright)_transparent]">
        <div
          v-if="diffRows.length === 0"
          class="flex min-h-[120px] items-center justify-center text-[11.5px] text-text-dim italic"
        >
          No differences in {{ selectedFile }}
        </div>
        <div
          v-else
          class="w-max min-w-full font-[ui-monospace,'SF_Mono','Cascadia_Code','Fira_Code',monospace] text-[11.5px] leading-[1.55]"
        >
          <div
            v-for="(line, li) in diffRows"
            :key="li"
            class="flex w-full items-stretch"
            :class="{
              'bg-[color-mix(in_srgb,var(--color-success)_12%,transparent)]': line.type === 'add',
              'bg-[color-mix(in_srgb,var(--color-danger)_12%,transparent)]': line.type === 'del',
            }"
          >
            <div
              class="flex w-[72px] shrink-0 border-r border-[color-mix(in_srgb,var(--color-border-subtle)_30%,transparent)]"
              :class="{
                'bg-[color-mix(in_srgb,var(--color-success)_8%,transparent)]': line.type === 'add',
                'bg-[color-mix(in_srgb,var(--color-danger)_8%,transparent)]': line.type === 'del',
              }"
            >
              <span class="flex w-[36px] shrink-0 items-center justify-end px-1.5 text-right text-[10.5px] text-text-dim opacity-50 select-none">{{ line.oldLine }}</span>
              <span class="flex w-[36px] shrink-0 items-center justify-end px-1.5 text-right text-[10.5px] text-text-dim opacity-50 select-none">{{ line.newLine }}</span>
            </div>
            <div
              class="flex w-[18px] shrink-0 items-center justify-center text-[12px] font-semibold select-none"
              :class="{
                'text-success': line.type === 'add',
                'text-danger': line.type === 'del',
              }"
            >
              {{ line.type === 'add' ? '+' : line.type === 'del' ? '−' : ' ' }}
            </div>
            <div
              class="flex-1 whitespace-pre px-3"
              :class="{
                'text-[color-mix(in_srgb,var(--color-success)_60%,var(--color-text-primary))]': line.type === 'add',
                'text-[color-mix(in_srgb,var(--color-danger)_60%,var(--color-text-primary))]': line.type === 'del',
                'text-text-dim opacity-70': line.type === 'ctx',
              }"
            >
              {{ line.text }}
            </div>
          </div>
          <div v-if="diffTruncated" class="border-t border-border-subtle px-3 py-1.5 text-[10.5px] text-text-dim select-none">
            … truncated at {{ MAX_DIFF_ROWS }} rows
          </div>
        </div>
      </div>
    </div>
  </Teleport>
</template>
