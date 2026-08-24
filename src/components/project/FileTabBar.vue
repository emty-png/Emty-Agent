<script setup lang="ts">
import { ChevronLeft, ChevronRight, X } from 'lucide-vue-next'
import { storeToRefs } from 'pinia'
import { nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { useFileTabsStore } from '@/stores/fileTabs'

const ft = useFileTabsStore()
const { tabs, activeId } = storeToRefs(ft)

// ── scroll state ──────────────────────────────────────────────────────────────
const tabListRef = ref<HTMLElement | null>(null)
const canScrollLeft = ref(false)
const canScrollRight = ref(false)
const TOLERANCE = 2

let scrollRaf = 0

function updateScrollState() {
  const el = tabListRef.value
  if (!el)
    return
  canScrollLeft.value = el.scrollLeft > TOLERANCE
  canScrollRight.value = el.scrollWidth - el.scrollLeft - el.clientWidth > TOLERANCE
}

function onScroll() {
  cancelAnimationFrame(scrollRaf)
  scrollRaf = requestAnimationFrame(updateScrollState)
}

function scrollTabsLeft() {
  tabListRef.value?.scrollBy({ left: -200, behavior: 'smooth' })
}

function scrollTabsRight() {
  tabListRef.value?.scrollBy({ left: 200, behavior: 'smooth' })
}

let resizeObserver: ResizeObserver | null = null

watch(tabs, () => {
  nextTick(updateScrollState)
}, { flush: 'post' })

onMounted(() => {
  const el = tabListRef.value
  if (el) {
    resizeObserver = new ResizeObserver(() => {
      cancelAnimationFrame(scrollRaf)
      scrollRaf = requestAnimationFrame(updateScrollState)
    })
    resizeObserver.observe(el)
    updateScrollState()
  }
})

onUnmounted(() => {
  cancelAnimationFrame(scrollRaf)
  resizeObserver?.disconnect()
})

// ── middle-click to close ─────────────────────────────────────────────────────
function onMouseDown(e: MouseEvent, id: string) {
  if (e.button === 1) {
    e.preventDefault()
    ft.closeTab(id)
  }
}
</script>

<template>
  <div class="flex h-[36px] min-h-[36px] items-end bg-[var(--color-bg-surface)] px-1 [box-shadow:inset_0_-1px_0_var(--color-border-subtle)]">
    <div class="flex min-w-0 flex-1 items-end overflow-hidden">
      <!-- scroll left -->
      <button
        v-show="canScrollLeft"
        class="relative z-[2] mb-[4px] flex h-[26px] w-[24px] shrink-0 cursor-pointer items-center justify-center rounded-[var(--radius-sm)] border-none bg-transparent text-[var(--color-text-tertiary)] transition-[background,color] duration-[120ms] ease-[ease] hover:bg-[var(--color-bg-hover)] hover:text-[var(--color-text-secondary)] after:pointer-events-none after:absolute after:-bottom-[4px] after:-right-[12px] after:-top-[2px] after:w-[12px] after:bg-gradient-to-r after:from-[var(--color-bg-surface)] after:from-[30%] after:to-transparent after:content-['']"
        @click="scrollTabsLeft"
      >
        <ChevronLeft :size="14" :stroke-width="2" />
      </button>

      <!-- tab list -->
      <div ref="tabListRef" class="flex min-w-0 flex-1 items-end overflow-x-auto overflow-y-hidden" @scroll="onScroll">
        <button
          v-for="tab in tabs"
          :key="tab.id"
          class="group/tab flex h-[30px] w-[140px] min-w-[140px] shrink-0 items-center gap-[5px] whitespace-nowrap rounded-t-[var(--radius-sm)] border-b border-l border-r border-t pl-[10px] pr-[8px] text-[12px] font-[450] transition-[background,color,border-color] duration-[120ms] ease-[ease]"
          :class="tab.id === activeId
            ? 'cursor-default border-b-[var(--color-bg-base)] border-l-[var(--color-border-subtle)] border-r-[var(--color-border-subtle)] border-t-[var(--color-border-subtle)] bg-[var(--color-bg-base)] text-[var(--color-text-primary)]'
            : 'cursor-pointer border-b-[var(--color-border-subtle)] border-l-transparent border-r-transparent border-t-transparent bg-transparent text-[var(--color-text-tertiary)] hover:bg-[var(--color-bg-hover)] hover:text-[var(--color-text-secondary)]'"
          @click="ft.setActive(tab.id)"
          @mousedown="onMouseDown($event, tab.id)"
        >
          <span class="min-w-0 flex-1 overflow-hidden text-ellipsis">{{ tab.name }}</span>
          <span
            class="grid h-[16px] w-[16px] shrink-0 place-items-center rounded-[var(--radius-sm)] text-[var(--color-text-tertiary)] transition-[opacity,background] duration-[120ms] ease-[ease] hover:bg-[var(--color-bg-elevated)] hover:text-[var(--color-text-primary)]"
            :class="tab.id === activeId ? 'opacity-100' : 'opacity-0 group-hover/tab:opacity-100'"
            role="button"
            aria-label="Close tab"
            @click.stop="ft.closeTab(tab.id)"
          >
            <X :size="11" :stroke-width="2" />
          </span>
        </button>
      </div>

      <!-- scroll right -->
      <button
        v-show="canScrollRight"
        class="relative z-[2] mb-[4px] flex h-[26px] w-[24px] shrink-0 cursor-pointer items-center justify-center rounded-[var(--radius-sm)] border-none bg-transparent text-[var(--color-text-tertiary)] transition-[background,color] duration-[120ms] ease-[ease] hover:bg-[var(--color-bg-hover)] hover:text-[var(--color-text-secondary)] before:pointer-events-none before:absolute before:-bottom-[4px] before:-left-[12px] before:-top-[2px] before:w-[12px] before:bg-gradient-to-l before:from-[var(--color-bg-surface)] before:from-[30%] before:to-transparent before:content-['']"
        @click="scrollTabsRight"
      >
        <ChevronRight :size="14" :stroke-width="2" />
      </button>
    </div>
  </div>
</template>
