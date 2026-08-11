<script setup lang="ts">
import type { SubAgentInfo } from '@/stores/chat/core/types'

defineProps<{
  subAgent: SubAgentInfo
}>()

const bannerClasses = 'shrink-0 px-5 pb-4'
const innerClasses = 'max-w-[720px] mx-auto'
const bodyClasses = 'bg-(--color-bg-surface) border border-(--color-border-subtle) rounded-(--radius-lg) py-4 px-5'
const headerClasses = 'flex items-center gap-3 mb-2'
const nameClasses = 'text-sm font-semibold text-(--color-text-primary)'
const missionClasses = 'text-[13px] leading-[1.6] text-(--color-text-secondary) m-0'
</script>

<template>
  <div :class="bannerClasses">
    <div :class="innerClasses">
      <div :class="bodyClasses">
        <div :class="headerClasses">
          <span :class="nameClasses">
            {{ subAgent.personality.charAt(0).toUpperCase() + subAgent.personality.slice(1) }} Agent
          </span>
        </div>
        <p :class="missionClasses">
          {{ subAgent.mission }}
        </p>
      </div>
    </div>
  </div>
</template>
