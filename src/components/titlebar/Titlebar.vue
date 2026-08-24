<script setup lang="ts">
import { getCurrentWindow } from '@tauri-apps/api/window'
import { Copy, Menu, Minus, Square, WifiOff, X } from 'lucide-vue-next'
import { storeToRefs } from 'pinia'
import { nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { useSidebarStore } from '@/stores/sidebar'
import Sidebar from '../sidebar/Sidebar.vue'

interface Props {
  title?: string
  activeView?: 'chat' | 'history' | 'projects' | 'hooks' | 'developer'
}
const props = withDefaults(defineProps<Props>(), {
  activeView: 'chat',
})
const emit = defineEmits<{
  selectView: [view: 'chat' | 'history' | 'projects' | 'hooks' | 'developer']
  openSettings: []
}>()

const sidebar = useSidebarStore()
const { collapsed: sidebarCollapsed } = storeToRefs(sidebar)

const isOnline = ref(navigator.onLine)
function onOnline() { isOnline.value = true }
function onOffline() { isOnline.value = false }

const sidebarFlyoutOpen = ref(false)
const sidebarTriggerRef = ref<HTMLElement | null>(null)
const sidebarFlyoutRef = ref<HTMLElement | null>(null)
const sidebarFlyoutPos = ref({ top: 0, left: 0 })
let flyoutCloseTimer: ReturnType<typeof setTimeout> | null = null
const sidebarContextMenuOpen = ref(false)

function updateSidebarFlyoutPos() {
  const trigger = sidebarTriggerRef.value
  if (!trigger)
    return
  const rect = trigger.getBoundingClientRect()
  sidebarFlyoutPos.value = {
    top: rect.bottom + 6,
    left: rect.left + 4,
  }
}

function cancelCloseSidebarFlyout() {
  if (flyoutCloseTimer) {
    clearTimeout(flyoutCloseTimer)
    flyoutCloseTimer = null
  }
}

function closeSidebarFlyoutNow() {
  cancelCloseSidebarFlyout()
  sidebarFlyoutOpen.value = false
}

function scheduleCloseSidebarFlyout() {
  if (sidebarContextMenuOpen.value)
    return
  cancelCloseSidebarFlyout()
  flyoutCloseTimer = setTimeout(() => {
    sidebarFlyoutOpen.value = false
  }, 150)
}

async function openSidebarFlyout() {
  if (!sidebarCollapsed.value)
    return
  cancelCloseSidebarFlyout()
  updateSidebarFlyoutPos()
  sidebarFlyoutOpen.value = true
  await nextTick()
  updateSidebarFlyoutPos()
}

function onSidebarSelectView(view: 'chat' | 'history' | 'projects' | 'hooks' | 'developer') {
  emit('selectView', view)
  closeSidebarFlyoutNow()
}

function onSidebarOpenSettings() {
  emit('openSettings')
  closeSidebarFlyoutNow()
}

watch(sidebarCollapsed, collapsed => {
  if (!collapsed)
    closeSidebarFlyoutNow()
})

function onSidebarFlyoutPointerDown(event: PointerEvent) {
  if (!sidebarFlyoutOpen.value)
    return
  const target = event.target as Element
  if (sidebarTriggerRef.value?.contains(target))
    return
  if (sidebarFlyoutRef.value?.contains(target))
    return
  if (target.closest?.('.ctx-menu, .ctx-backdrop, .dialog, .dialog-backdrop'))
    return
  if (sidebarContextMenuOpen.value)
    return
  closeSidebarFlyoutNow()
}

function onSidebarFlyoutKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape' && sidebarFlyoutOpen.value)
    closeSidebarFlyoutNow()
}

function onSidebarFlyoutResize() {
  if (sidebarFlyoutOpen.value)
    updateSidebarFlyoutPos()
}

const appWindow = getCurrentWindow()
const maximized = ref(false)

async function syncMaximized() {
  maximized.value = await appWindow.isMaximized()
}

let unlisten: (() => void) | null = null
onMounted(async () => {
  await syncMaximized()
  unlisten = await appWindow.onResized(syncMaximized)

  document.addEventListener('pointerdown', onSidebarFlyoutPointerDown)
  document.addEventListener('keydown', onSidebarFlyoutKeydown)
  window.addEventListener('resize', onSidebarFlyoutResize)
  window.addEventListener('online', onOnline)
  window.addEventListener('offline', onOffline)
})
onUnmounted(() => {
  unlisten?.()
  cancelCloseSidebarFlyout()
  document.removeEventListener('pointerdown', onSidebarFlyoutPointerDown)
  document.removeEventListener('keydown', onSidebarFlyoutKeydown)
  window.removeEventListener('resize', onSidebarFlyoutResize)
  window.removeEventListener('online', onOnline)
  window.removeEventListener('offline', onOffline)
})

async function minimize() {
  await appWindow.minimize()
}
async function toggleMaximize() {
  if (await appWindow.isMaximized()) {
    await appWindow.unmaximize()
  }
  else {
    await appWindow.maximize()
  }
}
async function close() {
  await appWindow.close()
}

const ctrlBtnClass = 'flex items-center justify-center w-[46px] h-full border-none bg-transparent text-[var(--color-text-secondary)] cursor-default [-webkit-app-region:no-drag] transition-colors duration-[120ms] ease-in-out hover:bg-[var(--color-bg-hover)] hover:text-[var(--color-text-primary)] active:bg-[var(--color-bg-elevated)]'
</script>

<template>
  <header class="flex items-center h-[26px] min-h-[26px] max-h-[26px] bg-[var(--color-bg-surface)] border-b border-[var(--color-border-mid)] select-none relative z-[9999] shrink-0 [-webkit-app-region:drag]">
    <div class="flex items-center gap-1.5 flex-none min-w-0 max-w-[40%]">
      <div
        ref="sidebarTriggerRef"
        class="flex items-center shrink-0 [-webkit-app-region:no-drag]"
        @mouseenter="openSidebarFlyout"
        @mouseleave="scheduleCloseSidebarFlyout"
      >
        <button
          class="flex items-center justify-center w-[46px] h-[26px] border-none rounded-none bg-transparent text-[var(--color-text-tertiary)] cursor-pointer shrink-0 transition-colors duration-[120ms] ease-in-out active:bg-[var(--color-bg-elevated)]"
          :class="sidebarFlyoutOpen ? 'text-[var(--color-accent-text)] bg-[var(--color-accent-muted)]' : 'hover:text-[var(--color-accent-text)] hover:bg-[var(--color-accent-muted)]'"
          :aria-label="sidebarCollapsed ? 'Show sidebar' : 'Hide sidebar'"
          :title="sidebarCollapsed ? 'Show sidebar' : 'Hide sidebar'"
          aria-haspopup="true"
          :aria-expanded="sidebarFlyoutOpen"
          @click.stop="sidebar.toggle"
        >
          <Menu :size="15" :stroke-width="1.8" />
        </button>
      </div>

      <slot name="icon" />
    </div>

    <div class="flex-1 flex items-center justify-center min-w-0">
      <slot name="center" />
    </div>

    <div
      v-if="!isOnline"
      class="flex items-center gap-1 shrink-0 [-webkit-app-region:no-drag] px-2 py-0.5 mx-1 rounded-[var(--radius-sm)] bg-[var(--color-danger-muted)] animate-pulse-subtle"
      title="No internet connection"
    >
      <WifiOff
        :size="15"
        :stroke-width="2"
        class="text-[var(--color-danger-hover)]"
      />
      <span class="text-[11px] font-medium text-[var(--color-danger-hover)] leading-none">Offline</span>
    </div>

    <div class="flex items-stretch flex-none h-[29px] ml-auto [-webkit-app-region:no-drag]">
      <button :class="ctrlBtnClass" aria-label="Minimize" @click.stop="minimize">
        <Minus :size="15" :stroke-width="1.8" />
      </button>

      <button :class="ctrlBtnClass" aria-label="Toggle maximise" @click.stop="toggleMaximize">
        <Copy v-if="maximized" :size="13" :stroke-width="1.8" class="rotate-90" />
        <Square v-else :size="13" :stroke-width="1.8" />
      </button>

      <button class="hover:bg-[var(--color-danger)] hover:text-[var(--color-text-primary)] active:bg-[var(--color-danger-text)] active:text-[var(--color-text-primary)]" :class="[ctrlBtnClass]" aria-label="Close" @click.stop="close">
        <X :size="15" :stroke-width="1.8" />
      </button>
    </div>
  </header>

  <Teleport to="body">
    <Transition
      enter-active-class="transition-all duration-150 ease-[cubic-bezier(0.16,1,0.3,1)]"
      leave-active-class="transition-all duration-150 ease-[cubic-bezier(0.16,1,0.3,1)]"
      enter-from-class="opacity-0 -translate-y-1.5 scale-95"
      leave-to-class="opacity-0 -translate-y-1.5 scale-95"
    >
      <div
        v-if="sidebarFlyoutOpen"
        ref="sidebarFlyoutRef"
        class="fixed w-[196px] bg-[var(--color-bg-surface)] border border-[var(--color-border-mid)] rounded-[var(--radius-md)] shadow-[0_8px_24px_rgba(0,0,0,0.4),0_2px_6px_rgba(0,0,0,0.28)] overflow-hidden z-[9990] origin-top-left"
        :style="{ top: `${sidebarFlyoutPos.top}px`, left: `${sidebarFlyoutPos.left}px` }"
        @mouseenter="cancelCloseSidebarFlyout"
        @mouseleave="scheduleCloseSidebarFlyout"
      >
        <Sidebar
          flyout
          :active-view="props.activeView"
          @select-view="onSidebarSelectView"
          @open-settings="onSidebarOpenSettings"
          @context-menu-open="sidebarContextMenuOpen = true"
          @context-menu-close="sidebarContextMenuOpen = false"
        />
      </div>
    </Transition>
  </Teleport>
</template>
