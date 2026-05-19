<script setup lang="ts">
import { ChevronDown } from 'lucide-vue-next'
import { onMounted, onUnmounted, ref } from 'vue'

interface Option {
  label: string
  value: string
  icon?: string | undefined // Explicitly allow undefined for exactOptionalPropertyTypes
}

const props = defineProps<{
  modelValue: string
  options: Option[]
  label?: string
  placeholder?: string
  disabled?: boolean
}>()

const emit = defineEmits<{
  'update:modelValue': [value: string]
}>()

const isOpen = ref(false)
const containerRef = ref<HTMLElement | null>(null)

const selectedOption = ref<Option | null>(
  props.options.find(o => o.value === props.modelValue) || null,
)

function toggle() {
  if (props.disabled)
    return
  isOpen.value = !isOpen.value
}

function select(option: Option) {
  selectedOption.value = option
  emit('update:modelValue', option.value)
  isOpen.value = false
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
  <div ref="containerRef" class="scaffold-dropdown" :class="{ 'is-disabled': disabled }">
    <div v-if="label" class="dropdown-label">
      {{ label }}
    </div>

    <div class="dropdown-trigger" :class="{ 'is-open': isOpen }" @click="toggle">
      <div class="selected-content">
        <span v-if="selectedOption?.icon && selectedOption.icon.startsWith('<')" class="option-icon" v-html="selectedOption.icon" />
        <i v-else-if="selectedOption?.icon" class="option-icon devicon-icon" :class="selectedOption.icon" />
        <span class="selected-text">{{ selectedOption?.label || placeholder || 'Select...' }}</span>
      </div>
      <ChevronDown :size="14" class="chevron" :class="{ 'is-rotated': isOpen }" />
    </div>

    <Transition name="dropdown">
      <div v-if="isOpen" class="dropdown-menu">
        <button
          v-for="option in options"
          :key="option.value"
          class="dropdown-item"
          :class="{ 'is-active': option.value === modelValue }"
          type="button"
          @click="select(option)"
        >
          <span v-if="option.icon && option.icon.startsWith('<')" class="option-icon" v-html="option.icon" />
          <i v-else-if="option.icon" class="option-icon devicon-icon" :class="option.icon" />
          <span>{{ option.label }}</span>
        </button>
      </div>
    </Transition>
  </div>
</template>

<style scoped>
.scaffold-dropdown {
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

.dropdown-trigger {
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: 36px;
  padding-inline: 12px;
  background: var(--color-bg-base);
  border: 1px solid var(--color-border-subtle);
  border-radius: var(--radius-lg);
  cursor: pointer;
  transition: all 120ms ease;
  user-select: none;
}

.dropdown-trigger:hover:not(.is-disabled) {
  border-color: var(--color-border-mid);
  background: var(--color-bg-hover);
}

.dropdown-trigger.is-open {
  border-color: var(--color-accent-primary);
  box-shadow: 0 0 0 2px var(--color-accent-muted);
}

.is-disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.selected-content {
  display: flex;
  align-items: center;
  gap: 10px;
  overflow: hidden;
  color: var(--color-text-primary);
}

.selected-text {
  font-size: 13px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.chevron {
  color: var(--color-text-tertiary);
  transition: transform 200ms ease;
  flex-shrink: 0;
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
  overflow: hidden;
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
  background: var(--color-accent-muted);
  color: var(--color-accent-text);
}

.option-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  flex-shrink: 0;
}

.option-icon :deep(svg) {
  width: 100%;
  height: 100%;
}

.devicon-icon {
  font-size: 16px;
  display: flex;
  align-items: center;
  justify-content: center;
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
