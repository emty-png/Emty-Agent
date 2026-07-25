<script setup lang="ts">
import { Plus } from 'lucide-vue-next'
import { ref } from 'vue'
import BuiltInProviders from '@/components/settings/providers/BuiltInProviders.vue'
import CompatibleProviders from '@/components/settings/providers/CompatibleProviders.vue'
import ProviderBrowser from '@/components/settings/providers/ProviderBrowser.vue'

defineEmits<{ next: [] }>()

const showBrowser = ref(false)
</script>

<template>
  <div class="step-providers">
    <div class="step-header">
      <h2 class="step-title">
        Model Providers
      </h2>
      <p class="step-desc">
        Configure at least one AI provider to get started
      </p>
    </div>

    <div class="providers-scroll">
      <div class="providers-center">
        <BuiltInProviders />
        <CompatibleProviders />

        <button class="add-provider-btn" @click="showBrowser = true">
          <Plus :size="14" :stroke-width="2.5" />
          Add Provider
        </button>
      </div>
    </div>

    <div class="step-actions">
      <button class="step-btn" @click="$emit('next')">
        Next
      </button>
    </div>

    <ProviderBrowser v-model="showBrowser" />
  </div>
</template>

<style scoped>
.step-providers {
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow: hidden;
}

.step-header {
  flex-shrink: 0;
  padding-bottom: 16px;
  border-bottom: 1px solid var(--color-border-mid);
  margin-bottom: 16px;
}

.step-title {
  font-size: 20px;
  font-weight: 600;
  color: var(--color-text-primary);
  letter-spacing: -0.01em;
  margin: 0 0 4px 0;
}

.step-desc {
  font-size: 13px;
  color: var(--color-text-secondary);
  margin: 0;
}

.providers-scroll {
  flex: 1;
  overflow-y: auto;
  display: flex;
  align-items: flex-start;
  justify-content: center;
  padding-right: 8px;
}

.providers-center {
  display: flex;
  flex-direction: column;
  gap: 16px;
  width: 100%;
  max-width: 640px;
}

.add-provider-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  height: 40px;
  border: 1px dashed var(--color-border-mid);
  border-radius: var(--radius-md);
  background: transparent;
  color: var(--color-text-tertiary);
  font-size: 13px;
  font-weight: 500;
  font-family: inherit;
  cursor: pointer;
  transition: all 150ms ease;
}

.add-provider-btn:hover {
  background: color-mix(in srgb, var(--color-accent) 8%, transparent);
  color: var(--color-text-secondary);
  border-color: var(--color-border-strong);
}

.providers-scroll::-webkit-scrollbar {
  width: 6px;
}

.providers-scroll::-webkit-scrollbar-track {
  background: transparent;
}

.providers-scroll::-webkit-scrollbar-thumb {
  background: var(--color-border-mid);
  border-radius: 3px;
}

.step-actions {
  flex-shrink: 0;
  display: flex;
  justify-content: center;
  padding-top: 16px;
  border-top: 1px solid var(--color-border-mid);
  margin-top: 16px;
}

.step-btn {
  width: 100%;
  max-width: 640px;
  height: 36px;
  padding: 0 24px;
  border: 1px solid var(--color-border-mid);
  border-radius: var(--radius-md);
  background: var(--color-bg-elevated);
  color: var(--color-text-primary);
  font-size: 13px;
  font-weight: 500;
  font-family: inherit;
  cursor: pointer;
  transition: all 150ms ease;
  box-shadow: var(--color-shadow-sm);
}

.step-btn:hover {
  background: color-mix(in srgb, var(--color-accent) 15%, var(--color-bg-elevated));
  border-color: var(--color-border-strong);
}
</style>
