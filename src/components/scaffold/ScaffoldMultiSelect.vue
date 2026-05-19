<script setup lang="ts">
import { Check, ChevronDown, X } from 'lucide-vue-next'
import { computed, onMounted, onUnmounted, ref } from 'vue'

interface Option {
  label: string
  value: string
  icon?: string | undefined
}

const props = defineProps<{
  modelValue: string[]
  options: Option[]
  label?: string
  placeholder?: string
  disabled?: boolean
}>()

const emit = defineEmits<{
  'update:modelValue': [value: string[]]
}>()

const isOpen = ref(false)
const containerRef = ref<HTMLElement | null>(null)
const searchQuery = ref('')

const selectedOptions = computed(() => {
  return props.options.filter(o => props.modelValue.includes(o.value))
})

const filteredOptions = computed(() => {
  const query = searchQuery.value.toLowerCase().trim()
  if (!query)
    return props.options
  return props.options.filter(o =>
    o.label.toLowerCase().includes(query)
    || o.value.toLowerCase().includes(query),
  )
})

function toggle() {
  if (props.disabled)
    return
  isOpen.value = !isOpen.value
  if (isOpen.value)
    searchQuery.value = ''
}

function toggleOption(option: Option) {
  const newValue = [...props.modelValue]
  const index = newValue.indexOf(option.value)
  if (index === -1) {
    newValue.push(option.value)
  }
  else {
    newValue.splice(index, 1)
  }
  emit('update:modelValue', newValue)
}

function removeOption(value: string) {
  const newValue = props.modelValue.filter(v => v !== value)
  emit('update:modelValue', newValue)
}

function handleClickOutside(event: MouseEvent) {
  if (containerRef.value && !containerRef.value.contains(event.target as Node)) {
    isOpen.value = false
  }
}

onMounted(() => {
  window.addEventListener('click', handleClickOutside)
})

onUnmounted(() => {
  window.removeEventListener('click', handleClickOutside)
})
</script>

<template>
  <div ref="containerRef" class="scaffold-multiselect" :class="{ 'is-disabled': disabled }">
    <div v-if="label" class="dropdown-label">
      {{ label }}
    </div>

    <div class="multiselect-trigger" :class="{ 'is-open': isOpen }" @click="toggle">
      <div class="selected-tags">
        <template v-if="selectedOptions.length > 0">
          <template v-if="selectedOptions.length <= 3">
            <div
              v-for="opt in selectedOptions"
              :key="opt.value"
              class="tag"
              @click.stop
            >
              <span>{{ opt.label }}</span>
              <X :size="10" class="tag-remove" @click.stop="removeOption(opt.value)" />
            </div>
          </template>
          <span v-else class="selected-summary">{{ selectedOptions.length }} items selected</span>
        </template>
        <span v-else class="placeholder-text">{{ placeholder || 'Select add-ons...' }}</span>
      </div>
      <ChevronDown :size="14" class="chevron" :class="{ 'is-rotated': isOpen }" />
    </div>

    <Transition name="dropdown">
      <div v-if="isOpen" class="dropdown-menu">
        <div class="search-box">
          <input
            v-model="searchQuery"
            type="text"
            placeholder="Search add-ons..."
            class="search-input"
            @click.stop
          >
        </div>
        <div class="options-list">
          <button
            v-for="option in filteredOptions"
            :key="option.value"
            class="dropdown-item"
            :class="{ 'is-active': modelValue.includes(option.value) }"
            type="button"
            @click.stop="toggleOption(option)"
          >
            <div class="checkbox-box">
              <Check v-if="modelValue.includes(option.value)" :size="10" stroke-width="3" />
            </div>
            <span v-if="option.icon && option.icon.startsWith('<')" class="option-icon" v-html="option.icon" />
            <i v-else-if="option.icon" class="option-icon devicon-icon" :class="option.icon" />
            <span class="item-label">{{ option.label }}</span>
          </button>
          <div v-if="filteredOptions.length === 0" class="no-results">
            No add-ons found
          </div>
        </div>
      </div>
    </Transition>
  </div>
</template>

<style scoped>
.scaffold-multiselect {
  position: relative;
  width: 100%;
}

.dropdown-label {
  font-size: 11px;
  font-weight: 600;
  color: var(--color-text-tertiary);
  margin-bottom: 6px;
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.multiselect-trigger {
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: 36px;
  padding-inline: 10px;
  background: var(--color-bg-base);
  border: 1px solid var(--color-border-subtle);
  border-radius: var(--radius-lg);
  cursor: pointer;
  transition: all 120ms ease;
  user-select: none;
}

.multiselect-trigger:hover:not(.is-disabled) {
  border-color: var(--color-border-mid);
  background: var(--color-bg-hover);
}

.multiselect-trigger.is-open {
  border-color: var(--color-accent-primary);
  box-shadow: 0 0 0 2px var(--color-accent-muted);
}

.is-disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.selected-tags {
  display: flex;
  align-items: center;
  gap: 6px;
  flex: 1;
  overflow: hidden;
}

.tag {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 2px 6px;
  background: var(--color-bg-card);
  border: 1px solid var(--color-border-subtle);
  color: var(--color-text-primary);
  border-radius: var(--radius-md);
  font-size: 11px;
  font-weight: 500;
  white-space: nowrap;
  transition: all 100ms ease;
}

.tag:hover {
  border-color: var(--color-border-mid);
  background: var(--color-bg-hover);
}

.tag-remove {
  cursor: pointer;
  opacity: 0.6;
  color: var(--color-text-tertiary);
}

.tag-remove:hover {
  opacity: 1;
  color: var(--color-text-primary);
}

.selected-summary {
  font-size: 13px;
  color: var(--color-accent-text);
  font-weight: 500;
}

.placeholder-text {
  font-size: 13px;
  color: var(--color-text-tertiary);
}

.chevron {
  color: var(--color-text-tertiary);
  transition: transform 200ms ease;
  flex-shrink: 0;
  margin-left: 8px;
}

.chevron.is-rotated {
  transform: rotate(180deg);
}

.dropdown-menu {
  position: absolute;
  top: calc(100% + 4px);
  left: 0;
  right: 0;
  z-index: 1000;
  background: var(--color-bg-elevated);
  border: 1px solid var(--color-border-bright);
  border-radius: var(--radius-lg);
  box-shadow: var(--color-shadow-floating);
  padding: 5px;
  display: flex;
  flex-direction: column;
}

.search-box {
  padding: 5px;
  margin-bottom: 5px;
}

.search-input {
  width: 100%;
  height: 28px;
  padding-inline: 8px;
  background: var(--color-bg-base);
  border: 1px solid var(--color-border-subtle);
  border-radius: var(--radius-md);
  font-size: 12px;
  color: var(--color-text-primary);
  outline: none;
}

.search-input:focus {
  border-color: var(--color-accent-primary);
}

.options-list {
  max-height: 200px;
  overflow-y: auto;
  scrollbar-width: thin;
}

.dropdown-item {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  padding: 8px 10px;
  border: none;
  border-radius: var(--radius-md);
  background: transparent;
  color: var(--color-text-secondary);
  font-size: 13px;
  cursor: pointer;
  text-align: left;
  transition: all 100ms ease;
}

.dropdown-item:hover {
  background: var(--color-state-hover);
  color: var(--color-text-primary);
}

.dropdown-item.is-active {
  color: var(--color-accent-text);
}

.checkbox-box {
  width: 14px;
  height: 14px;
  border: 1.5px solid var(--color-border-mid);
  border-radius: var(--radius-sm);
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  background: var(--color-bg-base);
  color: var(--color-accent-text);
  transition: all 100ms ease;
}

.is-active .checkbox-box {
  background: var(--color-accent-primary);
  border-color: var(--color-accent-primary);
}

.no-results {
  padding: 20px;
  text-align: center;
  color: var(--color-text-tertiary);
  font-size: 12px;
}

/* Transitions */
.dropdown-enter-active,
.dropdown-leave-active {
  transition:
    opacity 150ms ease,
    transform 150ms ease;
}

.dropdown-enter-from,
.dropdown-leave-to {
  opacity: 0;
  transform: translateY(-8px);
}
</style>
