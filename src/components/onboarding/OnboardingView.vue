<script setup lang="ts">
import IllustrationOne from '@/components/chat/illustrastions/illustration_1.vue'
import { useOnboardingStore } from '@/stores/onboarding'
import EmptySide from './EmptySide.vue'

const onboarding = useOnboardingStore()
</script>

<template>
  <Transition name="onboarding-fade">
    <div
      v-if="onboarding.visible"
      class="fixed inset-0 z-[9998] flex bg-[var(--color-bg-base)]"
    >
      <!-- 70% illustration -->
      <div class="relative w-[70%] overflow-hidden">
        <IllustrationOne />
      </div>

      <!-- 30% empty side -->
      <div class="w-[30%] min-w-0 border-l border-[var(--color-border-subtle)]">
        <EmptySide />
      </div>
    </div>
  </Transition>
</template>

<style scoped>
.onboarding-fade-enter-active {
  transition: opacity 300ms ease;
}
.onboarding-fade-leave-active {
  transition: opacity 300ms ease;
}
.onboarding-fade-enter-from,
.onboarding-fade-leave-to {
  opacity: 0;
}
</style>
