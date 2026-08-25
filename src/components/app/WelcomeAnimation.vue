<script setup lang="ts">
import { watch } from 'vue'
import { useWelcomeStore } from '@/stores/welcome'

const welcome = useWelcomeStore()

let hideTimer: ReturnType<typeof setTimeout> | undefined

function dismiss() {
  clearTimeout(hideTimer)
  welcome.hide()
}

function scheduleHide() {
  clearTimeout(hideTimer)
  // Animation single run is 2030ms. Hide shortly after it fully fades (69% -> 0).
  // 2250ms gives a tiny hold on black before overlay fade.
  hideTimer = setTimeout(() => {
    welcome.hide()
  }, 2250)
}

watch(() => welcome.visible, isVisible => {
  clearTimeout(hideTimer)
  if (isVisible)
    scheduleHide()
}, { immediate: true })

watch(() => welcome.generation, () => {
  if (welcome.visible)
    scheduleHide()
})
</script>

<template>
  <Transition name="welcome-fade">
    <div
      v-if="welcome.visible"
      class="fixed inset-0 z-[9999] flex items-center justify-center bg-black"
      @click="dismiss"
    >
      <div :key="welcome.generation" class="pinwheel">
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" fill="currentColor" class="block h-full w-full overflow-visible text-white">
          <path d="M 84.64,30 L 50,30 L 50,50 L 15.36,30 L 32.68,60 L 50,50 L 50,90 L 67.32,60 L 50,50 Z" />
        </svg>
      </div>
    </div>
  </Transition>
</template>

<style scoped>
.pinwheel {
  width: min(22vmin, 180px);
  height: min(22vmin, 180px);
  animation: splashAnim 2.03s forwards;
  transform-origin: 50% 50%;
  will-change: transform, opacity;
  transform: translateZ(0);
  backface-visibility: hidden;
  -webkit-font-smoothing: antialiased;
}

@keyframes splashAnim {
  0% {
    transform: scale(0.04) rotate(-165deg) translateZ(0);
    opacity: 1;
    animation-timing-function: cubic-bezier(0.16, 1, 0.3, 1);
  }
  40% {
    transform: scale(1) rotate(0deg) translateZ(0);
    opacity: 1;
    animation-timing-function: cubic-bezier(0.45, 0, 0.55, 1);
  }
  48% {
    transform: scale(1) rotate(0deg) translateZ(0);
    opacity: 1;
    animation-timing-function: linear;
  }
  69% {
    transform: scale(1) rotate(0deg) translateZ(0);
    opacity: 0;
    animation-timing-function: linear;
  }
  100% {
    transform: scale(1) rotate(0deg) translateZ(0);
    opacity: 0;
  }
}

.welcome-fade-enter-active {
  transition: opacity 220ms ease;
}
.welcome-fade-leave-active {
  transition: opacity 420ms ease;
}
.welcome-fade-enter-from,
.welcome-fade-leave-to {
  opacity: 0;
}
</style>
