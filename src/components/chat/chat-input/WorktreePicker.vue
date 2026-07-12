<script setup lang="ts">
import type { WorktreeEntry } from '@/utils/worktrees'
import { Check, GitBranch, LoaderCircle, Search } from 'lucide-vue-next'
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'

const props = defineProps<{
  projectPath: string | null
  selectedPath: string | null
  triggerEl?: HTMLElement | null
}>()

const emit = defineEmits<{
  select: [path: string]
  close: []
}>()

const loading = ref(false)
const error = ref('')
const entries = ref<WorktreeEntry[]>([])
const searchQuery = ref('')

const selectedKey = computed(() => (props.selectedPath ?? props.projectPath ?? '').toLowerCase())

const filteredEntries = computed(() => {
  if (!searchQuery.value)
    return entries.value
  const query = searchQuery.value.toLowerCase()
  return entries.value.filter(e =>
    e.label.toLowerCase().includes(query)
    || e.path.toLowerCase().includes(query),
  )
})

async function loadWorktrees() {
  if (!props.projectPath) {
    entries.value = []
    error.value = ''
    return
  }

  loading.value = true
  error.value = ''

  try {
    const { listWorktrees } = await import('@/utils/worktrees')
    const result = await listWorktrees(props.projectPath)
    entries.value = result?.entries ?? []
    error.value = result?.error ?? ''
  }
  catch (err) {
    entries.value = []
    const raw = err instanceof Error ? err.message : String(err ?? 'Failed to load branches.')
    error.value = /not a git repository/i.test(raw) ? '' : raw
  }
  finally {
    loading.value = false
  }
}

function selectEntry(path: string) {
  emit('select', path)
}

const pickerPos = ref({ x: 0, y: 0 })
const placement = ref<'top' | 'bottom'>('top')

function updatePos() {
  const btn = props.triggerEl
  if (!btn)
    return

  const rect = btn.getBoundingClientRect()
  const centerX = rect.left + rect.width / 2

  const vw = document.documentElement.clientWidth || window.innerWidth
  const vh = document.documentElement.clientHeight || window.innerHeight

  const maxPopupHeight = Math.min(380, vh * 0.6)
  const spaceAbove = rect.top
  const spaceBelow = vh - rect.bottom

  const popupWidth = Math.min(280, vw - 40)
  const halfWidth = popupWidth / 2
  const padding = 12

  let boundedX = centerX
  if (boundedX - halfWidth < padding) {
    boundedX = halfWidth + padding
  }
  else if (boundedX + halfWidth > vw - padding) {
    boundedX = vw - halfWidth - padding
  }

  // Intelligently choose placement based on available vertical space
  if (spaceAbove < maxPopupHeight + 16 && spaceBelow > spaceAbove) {
    // Open below (shifted down from +8 to +12 for more breathing room)
    pickerPos.value = {
      x: Math.round(boundedX),
      y: Math.round(rect.bottom + 12),
    }
    placement.value = 'bottom'
  }
  else {
    // Open above (shifted slightly down from -8 to -4 to sit lower)
    pickerPos.value = {
      x: Math.round(boundedX),
      y: Math.round(rect.top - 4),
    }
    placement.value = 'top'
  }
}

let scrollRafId: number | null = null
function handleScroll(e: Event) {
  const target = e.target as Node | null
  if (target instanceof Element && target.closest('.worktree-picker'))
    return

  if (!scrollRafId) {
    scrollRafId = requestAnimationFrame(() => {
      updatePos()
      scrollRafId = null
    })
  }
}

onMounted(() => {
  updatePos()
  window.addEventListener('resize', updatePos, { passive: true })
  window.addEventListener('scroll', handleScroll, { capture: true, passive: true })
})

onUnmounted(() => {
  window.removeEventListener('resize', updatePos)
  window.removeEventListener('scroll', handleScroll, { capture: true })
  if (scrollRafId !== null)
    cancelAnimationFrame(scrollRafId)
})

watch(() => props.projectPath, loadWorktrees, { immediate: true })

// ── Tailwind Class Extractions ──────────────────────────────────────────────
const backdropClasses = 'fixed inset-0 bg-transparent z-[9998]'

const pickerClasses = computed(() => {
  const base = 'worktree-picker fixed w-[min(280px,calc(100vw-40px))] max-h-[min(380px,60vh)] flex flex-col bg-(--color-bg-surface) border border-(--color-border-mid) rounded-(--radius-lg) shadow-[0_12px_32px_rgba(0,0,0,0.45),0_2px_8px_rgba(0,0,0,0.3)] overflow-hidden z-[9999]'
  const transform = placement.value === 'bottom'
    ? '![transform:translate(-50%,0)]'
    : '![transform:translate(-50%,-100%)]'
  return `${base} ${transform}`
})

const searchWrapClasses = 'p-[10px_10px_8px] border-b border-(--color-border-mid) shrink-0'
const searchInnerClasses = 'relative flex-1'
const searchIconClasses = 'absolute left-2.5 top-1/2 -translate-y-1/2 text-(--color-text-tertiary) pointer-events-none'
const searchInputClasses = 'w-full h-8 pl-[30px] pr-2.5 bg-(--color-bg-card) border border-(--color-border-bright) rounded-(--radius-md) text-(--color-text-primary) text-[12.5px] outline-none box-border transition-[border-color,box-shadow] duration-150 ease-[cubic-bezier(0.4,0,0.2,1)] placeholder:text-(--color-text-dim) focus:border-(--color-accent) focus:shadow-[0_0_0_3px_var(--color-accent-muted),0_0_0_1px_var(--color-accent-muted-plus)]'

const emptyWrapClasses = 'p-4 text-center flex flex-col items-center gap-1'
const emptyIconClasses = 'text-(--color-text-dim) mb-0.5 opacity-60 flex'
const emptyTitleClasses = 'm-0 text-xs font-medium text-(--color-text-secondary)'
const emptyHintClasses = 'm-0 text-[11px] text-(--color-text-tertiary) leading-[1.5]'

const listClasses = 'flex flex-col overflow-y-auto overflow-x-hidden pt-1.5 pb-2 [scrollbar-width:thin] [scrollbar-color:var(--color-border-bright)_transparent] [&::-webkit-scrollbar]:w-1 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:bg-(--color-border-bright) [&::-webkit-scrollbar-thumb]:rounded-(--radius-md)'

function itemClasses(isActive: boolean) {
  const base = 'flex items-center gap-2.5 w-[calc(100%-12px)] mx-1.5 my-[1px] h-[34px] px-2 border border-transparent rounded-(--radius-md) bg-transparent text-(--color-text-secondary) cursor-pointer box-border text-left transition-[background,border-color,color] duration-100 ease-[cubic-bezier(0.4,0,0.2,1)]'
  if (!isActive) {
    return `${base} hover:bg-(--color-state-hover) hover:border-(--color-border-subtle) hover:text-(--color-text-primary)`
  }
  return `${base} bg-[color-mix(in_srgb,var(--color-accent)_15%,transparent)] border-(--color-accent-dim) text-(--color-text-primary) hover:bg-[color-mix(in_srgb,var(--color-accent)_22%,transparent)] hover:border-(--color-accent)`
}

const itemNameClasses = 'flex-1 min-w-0 text-[13px] font-medium text-inherit whitespace-nowrap overflow-hidden text-ellipsis'

// ── Transitions ─────────────────────────────────────────────────────────────
const fadeTransitions = {
  enterActiveClass: 'transition-opacity duration-150 ease-[cubic-bezier(0.16,1,0.3,1)]',
  leaveActiveClass: 'transition-opacity duration-100 ease-[cubic-bezier(0.7,0,0.84,0)]',
  enterFromClass: 'opacity-0',
  leaveToClass: 'opacity-0',
}

const pickerTransitions = computed(() => {
  const isBottom = placement.value === 'bottom'
  return {
    enterActiveClass: 'transition-[opacity,transform] duration-150 ease-[cubic-bezier(0.16,1,0.3,1)]',
    leaveActiveClass: 'transition-[opacity,transform] duration-100 ease-[cubic-bezier(0.7,0,0.84,0)]',
    enterFromClass: isBottom
      ? 'opacity-0 ![transform:translate(-50%,8px)_scale(0.96)]'
      : 'opacity-0 ![transform:translate(-50%,calc(-100%+8px))_scale(0.96)]',
    enterToClass: isBottom
      ? 'opacity-100 ![transform:translate(-50%,0)_scale(1)]'
      : 'opacity-100 ![transform:translate(-50%,-100%)_scale(1)]',
    leaveFromClass: isBottom
      ? 'opacity-100 ![transform:translate(-50%,0)_scale(1)]'
      : 'opacity-100 ![transform:translate(-50%,-100%)_scale(1)]',
    leaveToClass: isBottom
      ? 'opacity-0 ![transform:translate(-50%,8px)_scale(0.96)]'
      : 'opacity-0 ![transform:translate(-50%,calc(-100%+8px))_scale(0.96)]',
  }
})
</script>

<template>
  <Teleport to="body">
    <Transition v-bind="fadeTransitions" appear>
      <div :class="backdropClasses" @click="emit('close')" />
    </Transition>

    <Transition v-bind="pickerTransitions" appear>
      <div
        :class="pickerClasses"
        :style="{ left: `${pickerPos.x}px`, top: `${pickerPos.y}px` }"
      >
        <div :class="searchWrapClasses">
          <div :class="searchInnerClasses">
            <Search :size="13" :stroke-width="2" :class="searchIconClasses" />
            <input
              v-model="searchQuery"
              type="text"
              :class="searchInputClasses"
              placeholder="Search branches…"
              autocomplete="off"
              spellcheck="false"
              autofocus
            >
          </div>
        </div>

        <!-- Empty / Loading States -->
        <div v-if="error" :class="emptyWrapClasses">
          <span :class="emptyIconClasses">
            <GitBranch :size="18" :stroke-width="1.5" />
          </span>
          <p :class="emptyTitleClasses">
            {{ error }}
          </p>
        </div>

        <div v-else-if="loading && entries.length === 0" :class="emptyWrapClasses">
          <span :class="emptyIconClasses">
            <LoaderCircle :size="18" :stroke-width="1.5" class="animate-[spin_0.9s_linear_infinite]" />
          </span>
          <p :class="emptyTitleClasses">
            Inspecting branches…
          </p>
        </div>

        <div v-else-if="filteredEntries.length === 0" :class="emptyWrapClasses">
          <span :class="emptyIconClasses">
            <GitBranch :size="18" :stroke-width="1.5" />
          </span>
          <p :class="emptyTitleClasses">
            No branches found
          </p>
          <p :class="emptyHintClasses">
            No branches matched your search.
          </p>
        </div>

        <!-- Results List -->
        <div v-else :class="listClasses">
          <button
            v-for="entry in filteredEntries"
            :key="entry.path"
            :class="itemClasses(entry.path.toLowerCase() === selectedKey)"
            type="button"
            @click="selectEntry(entry.path)"
          >
            <GitBranch
              :size="15"
              :stroke-width="1.5"
              :class="entry.path.toLowerCase() === selectedKey ? 'text-(--color-accent-text) shrink-0' : 'text-(--color-text-tertiary) shrink-0'"
            />
            <span :class="itemNameClasses">{{ entry.label }}</span>
            <Check
              v-if="entry.path.toLowerCase() === selectedKey"
              :size="15"
              :stroke-width="1.5"
              class="text-(--color-accent-text) shrink-0"
            />
          </button>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>
