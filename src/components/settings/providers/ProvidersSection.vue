<script setup lang="ts">
import { Globe, Image, Plus, Zap } from 'lucide-vue-next'
import { ref } from 'vue'
import BuiltInProviders from './BuiltInProviders.vue'
import CompatibleProviders from './CompatibleProviders.vue'
import ImageGenProviders from './ImageGenProviders.vue'
import WebProviders from './WebProviders.vue'

const emit = defineEmits<{ browseProviders: [] }>()

const providerView = ref<'models' | 'web' | 'image'>('models')
</script>

<template>
  <section class="content-section">
    <h2 class="section-title">
      Providers
    </h2>

    <!-- View tabs -->
    <div class="view-tabs">
      <button
        class="view-tab"
        :class="{ 'view-tab--active': providerView === 'models' }"
        @click="providerView = 'models'"
      >
        <Zap :size="16" :stroke-width="1.8" />
        <span class="view-tab-title">Model Providers</span>
      </button>
      <button
        class="view-tab"
        :class="{ 'view-tab--active': providerView === 'web' }"
        @click="providerView = 'web'"
      >
        <Globe :size="16" :stroke-width="1.8" />
        <span class="view-tab-title">Web Providers</span>
      </button>
      <button
        class="view-tab"
        :class="{ 'view-tab--active': providerView === 'image' }"
        @click="providerView = 'image'"
      >
        <Image :size="16" :stroke-width="1.8" />
        <span class="view-tab-title">Image Gen Providers</span>
      </button>
    </div>

    <!-- Model Providers view -->
    <template v-if="providerView === 'models'">
      <BuiltInProviders />
      <CompatibleProviders />

      <!-- Add Provider card -->
      <div class="add-provider-card" @click="emit('browseProviders')">
        <div class="add-provider-icon">
          <Plus :size="20" :stroke-width="1.8" />
        </div>
        <div class="add-provider-text">
          <span class="add-provider-title">Add Provider</span>
          <span class="add-provider-desc">Browse 130+ OpenAI-compatible providers</span>
        </div>
      </div>
    </template>

    <!-- Web Providers view -->
    <template v-if="providerView === 'web'">
      <WebProviders />
    </template>

    <!-- Image Gen Providers view -->
    <template v-if="providerView === 'image'">
      <ImageGenProviders />
    </template>
  </section>
</template>

<style scoped>
.content-section {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.section-title {
  font-size: 20px;
  font-weight: 600;
  color: var(--color-text-primary);
  letter-spacing: -0.01em;
  margin-bottom: 4px;
}

.view-tabs {
  display: flex;
  gap: 10px;
  margin-bottom: 16px;
}

.view-tab {
  display: flex;
  align-items: center;
  gap: 12px;
  flex: 1;
  padding: 8px 12px;
  border: 1px solid var(--color-border-mid);
  border-radius: var(--radius-lg);
  background: var(--color-bg-surface);
  color: var(--color-text-secondary);
  cursor: pointer;
  transition: all 150ms ease;
  text-align: left;
}

.view-tab:hover {
  background: var(--color-state-hover);
  border-color: var(--color-border-strong);
  color: var(--color-text-primary);
}

.view-tab--active {
  background: var(--color-accent-muted);
  border-color: var(--color-accent-dim);
  color: var(--color-accent-text);
}

.view-tab--active:hover {
  background: var(--color-accent-muted);
  border-color: var(--color-accent-dim);
  color: var(--color-accent-text);
}

.view-tab-title {
  font-size: 13px;
  font-weight: 600;
}

.add-provider-card {
  display: flex;
  align-items: center;
  gap: 14px;
  width: 100%;
  max-width: 580px;
  padding: 14px 16px;
  border: 1px dashed var(--color-border-mid);
  border-radius: var(--radius-lg);
  background: var(--color-bg-surface);
  color: var(--color-text-secondary);
  cursor: pointer;
  transition: all 150ms ease;
  box-sizing: border-box;
}

.add-provider-card:hover {
  background: var(--color-state-hover);
  border-color: var(--color-border-strong);
  color: var(--color-text-primary);
}

.add-provider-icon {
  width: 40px;
  height: 40px;
  border-radius: var(--radius-md);
  background: var(--color-bg-elevated);
  display: grid;
  place-items: center;
  flex-shrink: 0;
  color: var(--color-text-tertiary);
}

.add-provider-card:hover .add-provider-icon {
  color: var(--color-accent);
}

.add-provider-text {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.add-provider-title {
  font-size: 13.5px;
  font-weight: 600;
  color: var(--color-text-primary);
}

.add-provider-desc {
  font-size: 12px;
  color: var(--color-text-tertiary);
}
</style>
