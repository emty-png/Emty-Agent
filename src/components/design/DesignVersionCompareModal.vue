<script setup lang="ts">
import type { DesignVersionRef } from '@/stores/chat/core/types'
import { join } from '@tauri-apps/api/path'
import { readTextFile } from '@tauri-apps/plugin-fs'
import { diffLines, diffWords } from 'diff'
import { ChevronDown, GitCompareArrows, RotateCcw, X } from 'lucide-vue-next'
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { useChatStore } from '@/stores/chat'
import { useDesignVersionStore } from '@/stores/designVersions'
import { VIEWPORT_PRESETS } from '@/utils/tools/design/constants'
import { injectConsoleBootstrap, injectPickerBootstrap } from '@/utils/tools/designProject'

interface ViewportInfo { width: number; height: number; preset: string }

const props = defineProps<{
  aId: string | null
  bId: string | null // b = live if null
  projectPath: string | null
  viewports?: Record<string, ViewportInfo> | null
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

// ── A/B version selection ────────────────────────────────────────────────────

type DeviceKey = keyof typeof VIEWPORT_PRESETS
const deviceOverride = ref<DeviceKey | null>(null)
const selectedA = ref('')
const selectedB = ref<string>('live')

const versionList = computed<DesignVersionRef[]>(() => {
  const list = dvStore.versionsByConversation[chat.activeTab.conversationId ?? ''] ?? []
  return props.projectPath ? list.filter(v => v.projectPath === props.projectPath) : list
})

function resolveVersion(id: string | null | undefined): DesignVersionRef | undefined {
  if (!id)
    return undefined
  return versionList.value.find(v => v.id === id) ?? (dvStore.getByMessageId(id) as unknown as DesignVersionRef | undefined)
}

const versionOptions = computed<Array<{ id: string; label: string }>>(() => {
  const out: Array<{ id: string; label: string }> = []
  const seen = new Set<string>()
  const a = resolveVersion(props.aId)
  if (a && !seen.has(a.id)) {
    seen.add(a.id)
    out.push({ id: a.id, label: a.label })
  }
  for (const v of versionList.value) {
    if (seen.has(v.id))
      continue
    seen.add(v.id)
    out.push({ id: v.id, label: v.label })
  }
  return out
})

watch(() => [props.aId, props.bId], () => {
  const a = resolveVersion(props.aId)
  selectedA.value = a?.id ?? props.aId ?? ''
  selectedB.value = props.bId ? (resolveVersion(props.bId)?.id ?? props.bId) : 'live'
}, { immediate: true })

// ── Snapshot loading ─────────────────────────────────────────────────────────

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
  const aId = selectedA.value
  if (!aId)
    return
  const aFiles = await dvStore.readSnapshotFiles(aId)
  aSrc.value = await buildSrcdoc(aFiles)
  aCode.value = aFiles[selectedFile.value] ?? ''
  const aVer = resolveVersion(aId)
  aLabel.value = aVer?.label ?? aId

  if (selectedB.value !== 'live' && selectedB.value) {
    const bFiles = await dvStore.readSnapshotFiles(selectedB.value)
    bSrc.value = await buildSrcdoc(bFiles)
    bCode.value = bFiles[selectedFile.value] ?? ''
    const bVer = resolveVersion(selectedB.value)
    bLabel.value = bVer?.label ?? selectedB.value
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
  else {
    bSrc.value = ''
    bCode.value = ''
    bLabel.value = 'Live'
  }
}

watch([selectedA, selectedB, () => props.projectPath, selectedFile], () => { void load() }, { immediate: true })

// ── Device-framed previews ───────────────────────────────────────────────────

const manifestViewport = computed(() => {
  const aVer = resolveVersion(selectedA.value)
  const vp = aVer?.screenName ? props.viewports?.[aVer.screenName] : undefined
  if (vp && typeof vp.width === 'number' && typeof vp.height === 'number') {
    const preset = (vp.preset && vp.preset in VIEWPORT_PRESETS ? vp.preset : 'mobile') as DeviceKey
    return { width: vp.width, height: vp.height, preset }
  }
  return null
})

const deviceKey = computed<DeviceKey>(() => deviceOverride.value ?? manifestViewport.value?.preset ?? 'mobile')

const activeViewport = computed(() => {
  if (deviceOverride.value) {
    const p = VIEWPORT_PRESETS[deviceOverride.value]
    return { width: p.width, height: p.height }
  }
  if (manifestViewport.value)
    return { width: manifestViewport.value.width, height: manifestViewport.value.height }
  const p = VIEWPORT_PRESETS.mobile
  return { width: p.width, height: p.height }
})

const paneSize = ref({ width: 0, height: 0 })
let paneObserver: ResizeObserver | null = null

function setPaneRef(el: unknown) {
  const el2 = el as HTMLElement | null
  paneObserver?.disconnect()
  paneObserver = null
  if (!el2)
    return
  paneObserver = new ResizeObserver(entries => {
    const rect = entries[0]?.contentRect
    if (rect)
      paneSize.value = { width: rect.width, height: rect.height }
  })
  paneObserver.observe(el2)
}

onUnmounted(() => {
  paneObserver?.disconnect()
  paneObserver = null
})

const frameScale = computed(() => {
  const PAD = 40
  const availW = paneSize.value.width - PAD
  const availH = paneSize.value.height - PAD
  if (availW <= 0 || availH <= 0)
    return 1
  return Math.max(0.05, Math.min(1, availW / activeViewport.value.width, availH / activeViewport.value.height))
})

// ── Code diff (real diff with word-level highlight + collapsed context) ─────

const CONTEXT_LINES = 4
const MAX_DIFF_ROWS = 800

interface DiffWord { value: string; added?: boolean; removed?: boolean }
interface DiffRow {
  type: 'ctx' | 'add' | 'del' | 'collapse'
  oldLine: string
  newLine: string
  text: string
  words?: DiffWord[]
  count?: number
  collapseId?: string
}

const expandedCollapses = ref<Set<string>>(new Set())

function toggleCollapse(id: string) {
  const next = new Set(expandedCollapses.value)
  if (next.has(id))
    next.delete(id)
  else
    next.add(id)
  expandedCollapses.value = next
}

const diffResult = computed<{ rows: DiffRow[]; truncated: boolean }>(() => {
  const a = aCode.value
  const b = bCode.value
  if (a === b)
    return { rows: [], truncated: false }

  const parts = diffLines(a, b)
  const raw: DiffRow[] = []
  let oldNo = 0
  let newNo = 0
  let truncated = false

  interface ChangedBlock { dels: string[]; adds: string[] }
  let block: ChangedBlock | null = null

  const splitLines = (value: string) => (value.endsWith('\n') ? value.slice(0, -1) : value).split('\n')

  const flushBlock = () => {
    if (!block)
      return
    const { dels, adds } = block
    const pairCount = Math.min(dels.length, adds.length)
    for (let i = 0; i < pairCount; i++) {
      let words: DiffWord[] | undefined
      const delText = dels[i] ?? ''
      const addText = adds[i] ?? ''
      if (delText.length < 2000 && addText.length < 2000)
        words = diffWords(delText, addText) as DiffWord[]
      raw.push({ type: 'del', oldLine: String(++oldNo), newLine: '', text: delText, ...(words ? { words } : {}) })
      raw.push({ type: 'add', oldLine: '', newLine: String(++newNo), text: addText, ...(words ? { words } : {}) })
    }
    for (let i = pairCount; i < dels.length; i++)
      raw.push({ type: 'del', oldLine: String(++oldNo), newLine: '', text: dels[i] ?? '' })
    for (let i = pairCount; i < adds.length; i++)
      raw.push({ type: 'add', oldLine: '', newLine: String(++newNo), text: adds[i] ?? '' })
    block = null
  }

  for (const part of parts) {
    if (!part.added && !part.removed) {
      flushBlock()
      for (const line of splitLines(part.value)) {
        oldNo++
        newNo++
        raw.push({ type: 'ctx', oldLine: String(oldNo), newLine: String(newNo), text: line })
      }
    }
    else {
      if (!block)
        block = { dels: [], adds: [] }
      if (part.removed)
        block.dels.push(...splitLines(part.value))
      else
        block.adds.push(...splitLines(part.value))
    }
    if (raw.length >= MAX_DIFF_ROWS) {
      truncated = true
      break
    }
  }
  flushBlock()

  // Collapse long unchanged runs
  const out: DiffRow[] = []
  let run: DiffRow[] = []
  const flushRun = () => {
    if (run.length <= CONTEXT_LINES * 2 + 1) {
      out.push(...run)
    }
    else {
      out.push(...run.slice(0, CONTEXT_LINES))
      const hidden = run.slice(CONTEXT_LINES, run.length - CONTEXT_LINES)
      const id = `collapse-${out.length}-${hidden.length}`
      if (expandedCollapses.value.has(id))
        out.push(...hidden)
      else
        out.push({ type: 'collapse', oldLine: '', newLine: '', text: '', count: hidden.length, collapseId: id })
      out.push(...run.slice(run.length - CONTEXT_LINES))
    }
    run = []
  }
  for (const r of raw) {
    if (r.type === 'ctx') {
      run.push(r)
    }
    else { flushRun(); out.push(r) }
  }
  flushRun()
  return { rows: out, truncated }
})

const diffRows = computed(() => diffResult.value.rows)
const diffTruncated = computed(() => diffResult.value.truncated)

// ── Escape closes the modal ──────────────────────────────────────────────────

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape')
    emit('close')
}

onMounted(() => {
  window.addEventListener('keydown', onKeydown)
})

onUnmounted(() => {
  window.removeEventListener('keydown', onKeydown)
})
</script>

<template>
  <Teleport to="body">
    <div class="fixed inset-0 z-[99990] flex flex-col bg-bg-base">
      <div class="flex shrink-0 items-center gap-2 border-b border-border-subtle bg-bg-base px-2.5 py-1.5">
        <GitCompareArrows :size="14" class="text-accent" />
        <select v-model="selectedA" class="cmp-select" aria-label="Compare base version">
          <option v-for="opt in versionOptions" :key="opt.id" :value="opt.id">
            {{ opt.label }}
          </option>
        </select>
        <span class="text-[11px] text-text-tertiary">↔</span>
        <select v-model="selectedB" class="cmp-select" aria-label="Compare target version">
          <option value="live">
            Live
          </option>
          <option v-for="opt in versionOptions" :key="opt.id" :value="opt.id">
            {{ opt.label }}
          </option>
        </select>
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

        <div v-if="codeTab === 'preview'" class="ml-2 flex items-center gap-1 rounded-sm border border-border-subtle bg-bg-card p-0.5">
          <button
            v-for="d in (Object.keys(VIEWPORT_PRESETS) as DeviceKey[])"
            :key="d"
            class="cursor-pointer rounded-sm border-none px-2 py-1 text-[11px] transition-colors duration-150"
            :class="deviceKey === d ? 'bg-accent-muted text-accent-text' : 'bg-transparent text-text-tertiary hover:bg-bg-hover hover:text-text-secondary'"
            @click="deviceOverride = deviceOverride === d ? null : d"
          >
            {{ VIEWPORT_PRESETS[d].label }}
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
          class="ml-2 inline-flex h-7 cursor-pointer items-center gap-1 rounded-sm border-none bg-accent px-3 text-[11px] font-semibold text-bg-base transition-opacity duration-150 hover:opacity-90 active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-50"
          :disabled="!selectedA"
          @click="selectedA && emit('restore', selectedA)"
        >
          <RotateCcw :size="12" /> Restore {{ aLabel }}
        </button>
        <button
          class="inline-flex h-[26px] w-[26px] cursor-pointer items-center justify-center rounded-sm border-none bg-transparent text-text-tertiary transition-colors duration-150 hover:bg-bg-hover hover:text-text-secondary active:bg-accent-muted active:text-accent-text"
          title="Close compare (Esc)"
          @click="emit('close')"
        >
          <X :size="14" :stroke-width="2" />
        </button>
      </div>

      <div v-if="codeTab === 'preview'" class="grid min-h-0 flex-1 grid-cols-2 gap-0">
        <div class="flex min-w-0 flex-col border-r border-border-subtle">
          <div class="border-b border-border-subtle bg-bg-surface px-3 py-1.5 text-[11px] font-semibold text-text-secondary">
            {{ aLabel }} <span class="ml-1 font-normal text-text-dim">{{ activeViewport.width }}×{{ activeViewport.height }}</span>
          </div>
          <div :ref="setPaneRef" class="flex min-h-0 flex-1 items-center justify-center overflow-hidden p-6">
            <div
              class="cmp-device-frame"
              :style="{ width: `${activeViewport.width}px`, height: `${activeViewport.height}px`, transform: `scale(${frameScale})` }"
            >
              <iframe class="h-full w-full border-0 bg-white" :srcdoc="aSrc" sandbox="allow-scripts allow-forms allow-same-origin" />
            </div>
          </div>
        </div>
        <div class="flex min-w-0 flex-col">
          <div class="border-b border-border-subtle bg-bg-surface px-3 py-1.5 text-[11px] font-semibold text-text-secondary">
            {{ bLabel }} <span class="ml-1 font-normal text-text-dim">{{ activeViewport.width }}×{{ activeViewport.height }}</span>
          </div>
          <div class="flex min-h-0 flex-1 items-center justify-center overflow-hidden p-6">
            <div
              class="cmp-device-frame"
              :style="{ width: `${activeViewport.width}px`, height: `${activeViewport.height}px`, transform: `scale(${frameScale})` }"
            >
              <iframe class="h-full w-full border-0 bg-white" :srcdoc="bSrc" sandbox="allow-scripts allow-forms allow-same-origin" />
            </div>
          </div>
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
            <template v-if="line.type === 'collapse'">
              <button
                class="flex w-full cursor-pointer items-center gap-1.5 border-none bg-transparent px-4 py-1 text-left text-[10.5px] text-text-dim transition-colors duration-150 hover:bg-bg-hover hover:text-text-secondary"
                @click="line.collapseId && toggleCollapse(line.collapseId)"
              >
                <ChevronDown :size="11" :stroke-width="2" />
                {{ line.count }} unchanged lines — click to expand
              </button>
            </template>
            <template v-else>
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
                <template v-if="line.words && (line.type === 'add' || line.type === 'del')">
                  <span
                    v-for="(w, wi) in line.words"
                    :key="wi"
                    :class="line.type === 'del'
                      ? (w.added ? 'hidden' : (w.removed ? 'cmp-word-del' : ''))
                      : (w.removed ? 'hidden' : (w.added ? 'cmp-word-add' : ''))"
                  >{{ w.value }}</span>
                </template>
                <template v-else>
                  {{ line.text }}
                </template>
              </div>
            </template>
          </div>
          <div v-if="diffTruncated" class="border-t border-border-subtle px-3 py-1.5 text-[10.5px] text-text-dim select-none">
            … truncated at {{ MAX_DIFF_ROWS }} rows
          </div>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.cmp-select {
  height: 24px;
  max-width: 170px;
  border-radius: 6px;
  border: 1px solid var(--color-border-subtle);
  background: var(--color-bg-card);
  color: var(--color-text-secondary);
  font-size: 11px;
  font-family: inherit;
  padding: 0 6px;
  cursor: pointer;
  outline: none;
  transition: border-color 150ms ease;
}
.cmp-select:focus {
  border-color: var(--color-accent);
}
.cmp-select option {
  background: var(--color-bg-surface);
  color: var(--color-text-primary);
}

.cmp-device-frame {
  position: relative;
  overflow: hidden;
  flex-shrink: 0;
  border-radius: 14px;
  border: 1px solid rgba(0, 0, 0, 0.55);
  background: #fff;
  box-shadow:
    0 18px 56px rgba(0, 0, 0, 0.5),
    0 2px 10px rgba(0, 0, 0, 0.35);
  transform-origin: center center;
}

.cmp-word-add {
  background: color-mix(in srgb, var(--color-success) 32%, transparent);
  border-radius: 2px;
}
.cmp-word-del {
  background: color-mix(in srgb, var(--color-danger) 32%, transparent);
  border-radius: 2px;
}
</style>
