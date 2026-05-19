<script setup lang="ts">
import type { SubAgentInfo } from '@/stores/chat/types'

defineProps<{
  subAgent: SubAgentInfo
}>()
</script>

<template>
  <div class="sa-banner">
    <div class="sa-banner-inner">
      <div class="sa-banner-body">
        <div class="sa-banner-header">
          <span class="sa-banner-name">
            {{ subAgent.personality.charAt(0).toUpperCase() + subAgent.personality.slice(1) }} Agent
          </span>
        </div>
        <p class="sa-banner-mission">
          {{ subAgent.mission }}
        </p>
      </div>
    </div>
  </div>
</template>

<style scoped>
.sa-banner {
  flex-shrink: 0;
  padding: 24px 20px 16px;
}
.sa-banner-inner {
  max-width: 720px;
  margin: 0 auto;
}
.sa-banner-body {
  background: var(--color-bg-surface);
  border: 1px solid var(--color-border-subtle);
  border-radius: var(--radius-lg);
  padding: 16px 20px;
}
.sa-banner-header {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 8px;
}
.sa-banner-name {
  font-size: 14px;
  font-weight: 600;
  color: var(--color-text-primary);
}
.sa-banner-mission {
  font-size: 13px;
  line-height: 1.6;
  color: var(--color-text-secondary);
  margin: 0;
}
</style>
