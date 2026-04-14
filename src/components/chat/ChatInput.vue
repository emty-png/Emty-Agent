<script setup lang="ts">
import { AudioLines, ChevronDown, Plus } from 'lucide-vue-next'
import { ref } from 'vue'

const emit = defineEmits<{ send: [value: string] }>()

const text = ref('')
const focused = ref(false)

function submit() {
  if (!text.value.trim())
    return
  emit('send', text.value)
  text.value = ''
}

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault()
    submit()
  }
}

// auto-grow textarea
function onInput(e: Event) {
  const el = e.target as HTMLTextAreaElement
  el.style.height = 'auto'
  el.style.height = `${Math.min(el.scrollHeight, 180)}px`
}
</script>

<template>
  <div class="input-shell" :class="[{ 'input-shell--focused': focused }]">
    <!-- ── textarea ─────────────────────────────────────────────────── -->
    <textarea
      v-model="text"
      class="input-field"
      placeholder="Type / for skills"
      rows="1"
      @focus="focused = true"
      @blur="focused = false"
      @keydown="onKeydown"
      @input="onInput"
    />

    <!-- ── toolbar ──────────────────────────────────────────────────── -->
    <div class="input-toolbar">
      <!-- attach -->
      <button class="tool-btn" aria-label="Add attachment">
        <Plus :size="15" :stroke-width="1.7" />
      </button>

      <!-- spacer -->
      <div class="tool-spacer" />

      <!-- model picker -->
      <button class="model-btn" aria-label="Select model">
        <span class="model-name">Sonnet 4.6</span>
        <span class="model-badge">Extended</span>
        <ChevronDown :size="12" :stroke-width="2" class="model-chevron" />
      </button>

      <!-- voice -->
      <button class="tool-btn tool-btn--voice" aria-label="Voice input">
        <AudioLines :size="15" :stroke-width="1.7" />
      </button>
    </div>
  </div>
</template>

<style scoped>
/* ── shell ───────────────────────────────────────────────────────────────── */
.input-shell {
  width: 100%;
  background: var(--color-bg-card);
  border: 1px solid var(--color-border-mid);
  border-radius: var(--radius-lg);
  display: flex;
  flex-direction: column;
  transition: border-color 120ms ease;
  overflow: hidden;
}

.input-shell--focused {
  border-color: var(--color-border-bright);
}

/* ── textarea ────────────────────────────────────────────────────────────── */
.input-field {
  width: 100%;
  min-height: 44px;
  max-height: 180px;
  padding: 12px 14px 4px;
  background: transparent;
  border: none;
  resize: none;
  color: var(--color-text-primary);
  font-size: 13.5px;
  font-family: inherit;
  line-height: 1.55;
  caret-color: var(--color-ember-bright);
}

.input-field::placeholder {
  color: var(--color-text-tertiary);
}

/* ── toolbar ─────────────────────────────────────────────────────────────── */
.input-toolbar {
  display: flex;
  align-items: center;
  gap: 2px;
  padding: 4px 6px 6px;
}

.tool-spacer {
  flex: 1;
}

/* ── icon buttons ────────────────────────────────────────────────────────── */
.tool-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border: none;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--color-text-tertiary);
  cursor: pointer;
  transition:
    background 120ms ease,
    color 120ms ease;
}

.tool-btn:hover {
  background: var(--color-bg-hover);
  color: var(--color-text-secondary);
}

.tool-btn--voice {
  color: var(--color-text-secondary);
}

/* ── model picker ────────────────────────────────────────────────────────── */
.model-btn {
  display: flex;
  align-items: center;
  gap: 5px;
  height: 28px;
  padding-inline: 8px 6px;
  border: none;
  border-radius: var(--radius-sm);
  background: transparent;
  cursor: pointer;
  transition: background 120ms ease;
}

.model-btn:hover {
  background: var(--color-bg-hover);
}

.model-name {
  font-size: 11.5px;
  font-weight: 600;
  color: var(--color-text-secondary);
  letter-spacing: 0.01em;
}

.model-badge {
  font-size: 11px;
  font-weight: 400;
  color: var(--color-text-tertiary);
}

.model-chevron {
  color: var(--color-text-tertiary);
  margin-left: 1px;
}
</style>
