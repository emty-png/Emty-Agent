<script setup lang="ts">
import { getCurrentWindow } from '@tauri-apps/api/window'
import { Minus, Plus, Square, X } from 'lucide-vue-next'
import { onMounted, onUnmounted, ref } from 'vue'

interface Props {
  title?: string
}
const props = withDefaults(defineProps<Props>(), {
  title: 'App',
})

const appWindow = getCurrentWindow()
const maximized = ref(false)

async function syncMaximized() {
  maximized.value = await appWindow.isMaximized()
}

let unlisten: (() => void) | null = null
onMounted(async () => {
  await syncMaximized()
  unlisten = await appWindow.onResized(syncMaximized)
})
onUnmounted(() => unlisten?.())

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
</script>

<template>
  <header class="titlebar">
    <div class="titlebar-left">
      <slot name="icon" />
      <span class="titlebar-title">{{ props.title }}</span>
    </div>

    <div class="titlebar-center">
      <slot name="center" />
    </div>

    <div class="titlebar-controls">
      <div class="icon-placeholder">
        <Plus :size="16" :stroke-width="1.8" />
      </div>

      <div class="divider" aria-hidden="true" />

      <button class="ctrl-btn" aria-label="Minimize" @click.stop="minimize">
        <Minus :size="16" :stroke-width="1.8" />
      </button>

      <button class="ctrl-btn" aria-label="Toggle maximise" @click.stop="toggleMaximize">
        <svg
          v-if="maximized"
          width="22"
          height="21"
          style="margin-top: 6px"
          viewBox="0 0 22 21"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          aria-hidden="true"
        >
          <g filter="url(#filter0_d_19_5)">
            <path
              d="M8.13043 4.5H5V12H13.3478V9.5M8.13043 4.5H13.3478V9.5M8.13043 4.5V1H17V9.5H13.3478"
              stroke="currentColor"
              stroke-width="2"
              shape-rendering="crispEdges"
            />
          </g>
          <defs>
            <filter
              id="filter0_d_19_5"
              x="0"
              y="0"
              width="22"
              height="21"
              filterUnits="userSpaceOnUse"
              color-interpolation-filters="sRGB"
            >
              <feFlood flood-opacity="0" result="BackgroundImageFix" />
              <feColorMatrix
                in="SourceAlpha"
                type="matrix"
                values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 127 0"
                result="hardAlpha"
              />
              <feOffset dy="4" />
              <feGaussianBlur stdDeviation="2" />
              <feComposite in2="hardAlpha" operator="out" />
              <feColorMatrix type="matrix" values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0.25 0" />
              <feBlend mode="normal" in2="BackgroundImageFix" result="effect1_dropShadow_19_5" />
              <feBlend
                mode="normal"
                in="SourceGraphic"
                in2="effect1_dropShadow_19_5"
                result="shape"
              />
            </filter>
          </defs>
        </svg>
        <Square v-else :size="14" :stroke-width="1.8" />
      </button>

      <button class="ctrl-btn ctrl-btn--close" aria-label="Close" @click.stop="close">
        <X :size="16" :stroke-width="1.8" />
      </button>
    </div>
  </header>
</template>

<style scoped>
.titlebar {
  display: flex;
  align-items: center;
  height: 29px;
  min-height: 29px;
  max-height: 29px;
  padding-inline: 10px 0;
  background: var(--color-bg-surface);
  border-bottom: 1px solid var(--color-border-mid);
  user-select: none;
  -webkit-user-select: none;
  position: relative;
  z-index: 9999;
  flex-shrink: 0;
  -webkit-app-region: drag;
}

.titlebar-left {
  display: flex;
  align-items: center;
  gap: 6px;
  flex: 0 0 auto;
}

.titlebar-title {
  font-size: 12px;
  font-weight: 500;
  letter-spacing: 0.01em;
  color: var(--color-text-secondary);
  line-height: 1;
  pointer-events: none;
}

.titlebar-center {
  flex: 1 1 0;
  display: flex;
  align-items: center;
  justify-content: center;
  min-width: 0;
}

.titlebar-controls {
  display: flex;
  align-items: stretch;
  flex: 0 0 auto;
  height: 29px;
  margin-left: auto;
  -webkit-app-region: no-drag;
}

.icon-placeholder {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 46px;
  height: 100%;
  color: var(--color-text-secondary);
  -webkit-app-region: no-drag;
}

.divider {
  width: 1px;
  height: 12px;
  align-self: center;
  background: var(--color-border-mid);
  flex-shrink: 0;
}

.ctrl-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 46px;
  height: 100%;
  border: none;
  outline: none;
  background: transparent;
  color: var(--color-text-secondary);
  cursor: default;
  -webkit-app-region: no-drag;
  transition:
    background 120ms ease,
    color 120ms ease;
}

.ctrl-btn:hover {
  background: var(--color-bg-hover);
  color: var(--color-text-primary);
}

.ctrl-btn:active {
  background: var(--color-bg-elevated);
}

.ctrl-btn--close:hover {
  background: var(--color-rose);
  color: #fff;
}

.ctrl-btn--close:active {
  background: var(--color-rose-text);
  color: #fff;
}
</style>
