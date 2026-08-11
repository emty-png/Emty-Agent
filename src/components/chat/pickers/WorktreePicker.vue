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

  if (spaceAbove < maxPopupHeight + 16 && spaceBelow > spaceAbove) {
    pickerPos.value = {
      x: Math.round(boundedX),
      y: Math.round(rect.bottom + 12),
    }
    placement.value = 'bottom'
  }
  else {
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

const backdropClasses = 'fixed inset-0 bg-transparent z-[9998]'

const pickerClasses = computed(() => {
  const base = 'worktree-picker fixed w-[260px] max-h-[250px] flex flex-col bg-(--color-bg-surface) border border-(--color-border-mid) rounded-(--radius-lg) shadow-[0_12px_32px_rgba(0,0,0,0.45),0_2px_8px_rgba(0,0,0,0.3)] overflow-hidden z-[9999] -translate-x-1/2'
  if (placement.value === 'bottom')
    return base
  return `${base} -translate-y-full`
})

const searchWrapClasses = 'p-2.5 border-b border-(--color-border-subtle) shrink-0'
const searchInnerClasses = 'relative flex-1'
const searchIconClasses = 'absolute left-2 top-1/2 -translate-y-1/2 text-(--color-text-dim) pointer-events-none'
const searchInputClasses = 'w-full h-7 pl-[28px] pr-2 bg-(--color-bg-card) border border-(--color-border-subtle) rounded-(--radius-sm) text-(--color-text-primary) text-[11.5px] outline-none box-border transition-[border-color,box-shadow] duration-150 ease-in-out placeholder:text-(--color-text-dim) focus:border-(--color-accent) focus:shadow-[0_0_0_2px_var(--color-accent-muted)]'

const emptyWrapClasses = 'p-3 text-center flex flex-col items-center gap-1'
const emptyIconClasses = 'text-(--color-text-dim) mb-0.5 opacity-60 flex'
const emptyTitleClasses = 'm-0 text-[11px] font-medium text-(--color-text-secondary)'
const emptyHintClasses = 'm-0 text-[10px] text-(--color-text-tertiary) leading-[1.5]'

const listClasses = 'flex flex-col overflow-y-auto overflow-x-hidden py-1.5 [scrollbar-width:thin] [scrollbar-color:var(--color-border-bright)_transparent]'

function itemClasses(isActive: boolean) {
  const base = 'flex items-center gap-2 w-[calc(100%-8px)] mx-1 my-[1px] h-7 px-2 border border-transparent rounded-(--radius-sm) bg-transparent text-(--color-text-secondary) cursor-pointer box-border text-left transition-[background,border-color,color] duration-100 ease-in-out'
  if (!isActive) {
    return `${base} hover:bg-(--color-state-hover) hover:border-(--color-border-subtle) hover:text-(--color-text-primary)`
  }
  return `${base} bg-[color-mix(in_srgb,var(--color-accent)_15%,transparent)] border-(--color-accent-dim) text-(--color-text-primary) hover:bg-[color-mix(in_srgb,var(--color-accent)_22%,transparent)] hover:border-(--color-accent)`
}

const itemNameClasses = 'flex-1 min-w-0 text-[12px] font-medium text-inherit whitespace-nowrap overflow-hidden text-ellipsis'

const fadeTransitions = {
  enterActiveClass: 'transition-opacity duration-[120ms] ease-in-out',
  leaveActiveClass: 'transition-opacity duration-100 ease-in-out',
  enterFromClass: 'opacity-0',
  leaveToClass: 'opacity-0',
}

const pickerTransitions = {
  enterActiveClass: 'transition-[opacity,transform] duration-[120ms] ease-in-out',
  leaveActiveClass: 'transition-[opacity,transform] duration-100 ease-in-out',
  enterFromClass: 'opacity-0 scale-[0.97] -translate-y-1',
  enterToClass: 'opacity-100 scale-100 translate-y-0',
  leaveFromClass: 'opacity-100 scale-100 translate-y-0',
  leaveToClass: 'opacity-0 scale-[0.97] -translate-y-1',
}
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
