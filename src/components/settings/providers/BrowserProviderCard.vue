<script setup lang="ts">
import type { MDevPreset } from '@/utils/modelsdev'

defineProps<{
  provider: MDevPreset
  iconUrl: string
  failedIcon: boolean
}>()

defineEmits<{ expand: [] }>()
</script>

<template>
  <button class="browser-card" @click="$emit('expand')">
    <div class="browser-card-icon">
      <img
        v-if="!failedIcon"
        :src="iconUrl"
        :alt="provider.name"
      >
      <span v-else class="browser-card-fallback">{{ provider.name[0] }}</span>
    </div>
    <span class="browser-card-name">{{ provider.name }}</span>
  </button>
</template>

<style scoped>
.browser-card {
  display: flex;
  align-items: center;
  gap: 14px;
  width: 100%;
  padding: 10px 14px;
  border: 1px solid var(--color-border-subtle);
  border-radius: var(--radius-lg);
  background: var(--color-bg-surface);
  cursor: pointer;
  transition: all 150ms ease;
  box-sizing: border-box;
}

.browser-card:hover {
  background: var(--color-bg-hover);
  border-color: var(--color-border-strong);
}

.browser-card-icon {
  width: 32px;
  height: 32px;
  background: #ffffff;
  border-radius: var(--radius-md);
  border: 1px solid var(--color-border-mid);
  display: grid;
  place-items: center;
  flex-shrink: 0;
  overflow: hidden;
}

.browser-card-icon img {
  width: 20px;
  height: 20px;
  object-fit: contain;
}

.browser-card-fallback {
  font-size: 14px;
  font-weight: 700;
  color: #333;
}

.browser-card-name {
  font-size: 14px;
  font-weight: 600;
  color: var(--color-text-primary);
  line-height: 1.2;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
