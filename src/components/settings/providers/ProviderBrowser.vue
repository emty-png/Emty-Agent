<script setup lang="ts">
import type { CustomProviderData } from './BrowserCustomCard.vue'
import { Search, X } from 'lucide-vue-next'
import { computed, ref, watch } from 'vue'
import { useSettingsStore } from '@/stores/settings'
import { ALL_PROVIDERS, getProviderIconUrl } from '@/utils/modelsdev'
import BrowserCustomCard from './BrowserCustomCard.vue'
import BrowserProviderCard from './BrowserProviderCard.vue'
import BrowserProviderCardExpanded from './BrowserProviderCardExpanded.vue'

const props = defineProps<{ modelValue: boolean }>()
const emit = defineEmits<{ 'update:modelValue': [value: boolean] }>()

const s = useSettingsStore()

// search
const searchQuery = ref('')
const searchInputRef = ref<HTMLInputElement | null>(null)

const BUILTIN_IDS = new Set(['openai', 'anthropic', 'google'])

const filteredProviders = computed(() => {
  const q = searchQuery.value.toLowerCase().trim()
  const base = ALL_PROVIDERS.filter(p => !BUILTIN_IDS.has(p.id))
  if (!q)
    return base
  return base.filter(
    p => p.name.toLowerCase().includes(q) || p.id.toLowerCase().includes(q),
  )
})

const expandedId = ref<string | null>(null)
const formError = ref('')
const submitting = ref(false)

function expandProvider(id: string) {
  expandedId.value = id
  formError.value = ''
}

function collapseCard() {
  expandedId.value = null
  formError.value = ''
}

async function submitPreset(p: { id: string; name: string; api: string }, apiKey: string) {
  formError.value = ''
  submitting.value = true
  try {
    const providerId = s.addProvider({
      name: p.name,
      baseURL: p.api,
      apiKey: apiKey.trim(),
      mdevId: p.id,
    })
    close()
    void s.testProvider(providerId)
  }
  catch {
    formError.value = 'Failed to add provider'
  }
  finally {
    submitting.value = false
  }
}

async function submitCustom(data: CustomProviderData) {
  try {
    const providerId = s.addProvider({
      name: data.name,
      baseURL: data.baseURL,
      apiKey: data.apiKey,
      mdevId: data.id,
      ...(Object.keys(data.headers).length > 0 ? { headers: data.headers } : {}),
      ...(data.models.length > 0 ? { models: data.models } : {}),
    })
    close()
    void s.testProvider(providerId)
  }
  catch {
    // BrowserCustomCard handles its own errors
  }
}

function close() {
  emit('update:modelValue', false)
  searchQuery.value = ''
  expandedId.value = null
  formError.value = ''
}

watch(() => props.modelValue, open => {
  if (open)
    setTimeout(() => searchInputRef.value?.focus(), 100)
})

// icons
const failedIcons = ref(new Set<string>())

function getIconUrl(id: string): string {
  return getProviderIconUrl(id)
}
</script>

<template>
  <Teleport to="body">
    <Transition name="browser-fade">
      <div
        v-if="modelValue"
        class="browser-backdrop"
        data-overlay
        @click.self="close"
        @keydown.escape="close"
      >
        <div class="browser-modal" role="dialog" aria-label="Browse providers">
          <!-- header -->
          <div class="browser-header">
            <h3 class="browser-title">
              Add Provider
            </h3>
            <button class="browser-close" aria-label="Close" @click="close">
              <X :size="14" :stroke-width="2" />
            </button>
          </div>

          <!-- search -->
          <div class="browser-search">
            <Search :size="16" :stroke-width="1.8" class="browser-search-icon" />
            <input
              ref="searchInputRef"
              v-model="searchQuery"
              class="browser-search-input"
              placeholder="Search providers..."
              autocomplete="off"
              spellcheck="false"
            >
          </div>

          <!-- grid -->
          <div class="browser-grid">
            <template v-for="provider in filteredProviders" :key="provider.id">
              <BrowserProviderCard
                v-if="expandedId !== provider.id"
                :provider="provider"
                :icon-url="getIconUrl(provider.id)"
                :failed-icon="failedIcons.has(provider.id)"
                @expand="expandProvider(provider.id)"
              />
              <BrowserProviderCardExpanded
                v-else
                :provider="provider"
                :icon-url="getIconUrl(provider.id)"
                :failed-icon="failedIcons.has(provider.id)"
                :form-error="formError"
                :submitting="submitting"
                @collapse="collapseCard"
                @submit="key => submitPreset(provider, key)"
              />
            </template>

            <BrowserCustomCard @submit="submitCustom" />
          </div>

          <!-- empty state -->
          <div v-if="filteredProviders.length === 0" class="browser-empty">
            No providers matching "{{ searchQuery }}"
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.browser-backdrop {
  position: fixed;
  inset: 0;
  z-index: 9999;
  display: flex;
  align-items: center;
  justify-content: center;
  background: color-mix(in srgb, var(--color-bg-base) 65%, transparent);
}

.browser-modal {
  display: flex;
  flex-direction: column;
  width: 90vw;
  max-width: 640px;
  max-height: 80vh;
  background: var(--color-bg-surface);
  border: 1px solid var(--color-border-mid);
  border-radius: var(--radius-lg);
  box-shadow: var(--color-shadow-floating);
  overflow: hidden;
}

.browser-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 20px 12px;
  border-bottom: 1px solid var(--color-border-subtle);
}

.browser-title {
  font-size: 16px;
  font-weight: 600;
  color: var(--color-text-primary);
  margin: 0;
}

.browser-close {
  display: grid;
  place-items: center;
  width: 28px;
  height: 28px;
  border: none;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--color-text-tertiary);
  cursor: pointer;
  transition: all 120ms ease;
}

.browser-close:hover {
  background: var(--color-bg-hover);
  color: var(--color-text-primary);
}

.browser-search {
  position: relative;
  padding: 12px 20px;
  border-bottom: 1px solid var(--color-border-subtle);
}

.browser-search-icon {
  position: absolute;
  left: 32px;
  top: 50%;
  transform: translateY(-50%);
  color: var(--color-text-tertiary);
  pointer-events: none;
}

.browser-search-input {
  width: 100%;
  height: 36px;
  padding: 0 12px 0 36px;
  background: var(--color-bg-card);
  border: 1px solid var(--color-border-mid);
  border-radius: var(--radius-md);
  color: var(--color-text-primary);
  font-size: 13px;
  font-family: inherit;
  outline: none;
  transition: border-color 150ms ease;
  box-sizing: border-box;
}

.browser-search-input:focus {
  border-color: var(--color-accent-dim);
}

.browser-search-input::placeholder {
  color: var(--color-text-tertiary);
}

.browser-grid {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 14px 20px;
  overflow-y: auto;
  flex: 1;
}

.browser-empty {
  padding: 32px 20px;
  text-align: center;
  font-size: 13px;
  color: var(--color-text-tertiary);
}

.browser-fade-enter-active,
.browser-fade-leave-active {
  transition: opacity 200ms ease;
}

.browser-fade-enter-active .browser-modal,
.browser-fade-leave-active .browser-modal {
  transition: transform 200ms ease;
}

.browser-fade-enter-from,
.browser-fade-leave-to {
  opacity: 0;
}

.browser-fade-enter-from .browser-modal,
.browser-fade-leave-to .browser-modal {
  transform: scale(0.95) translateY(8px);
}
</style>
