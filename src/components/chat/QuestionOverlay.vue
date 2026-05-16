<script setup lang="ts">
/**
 * QuestionOverlay.vue
 *
 * Renders the ask_questions UI above the chat input.
 * Reads pendingBatch directly from the questions module — no props needed.
 *
 * Step machine:
 *   • The user is shown one question at a time.
 *   • Options are clickable buttons; pressing one immediately advances.
 *   • The final option is a free-text input. The user types then presses Enter to confirm.
 *   • Esc or the Skip button marks the current question as "skipped" and advances.
 *   • The < and > arrows allow navigating back and forth between questions.
 *   • The × button in the header dismisses all remaining questions as "skipped".
 *   • After the last question, submitAnswers() resolves the tool Promise.
 *
 * Keyboard navigation:
 *   ↑ / ↓ — move between options (wraps)
 *   Enter  — confirm selection; if on free-text row, focus the input first,
 *             then Enter in the input submits the text
 *   Esc    — skip current question and advance
 */

import { ChevronLeft, ChevronRight, Pencil, X } from 'lucide-vue-next'
import { computed, nextTick, onUnmounted, ref, watch } from 'vue'
import { useChatStore } from '@/stores/chat'

const chat = useChatStore()
const pendingBatch = computed(() => chat.activeTab.pendingQuestions)

// ── local step machine state ──────────────────────────────────────────────────

/** Index of the question currently being displayed (0-based). */
const step = ref(0)

/** Collected answers, one slot per question. null = not yet answered. */
const localAnswers = ref<Array<string | null>>([])

/**
 * Which row the keyboard cursor is on.
 *   0 to N-1 = preset options
 *   N = free-text row
 */
const selectedIdx = ref(0)

/** Contents of the free-text input on the current step. */
const freeText = ref('')

const freeTextRef = ref<HTMLInputElement | null>(null)

/** Prevents double-advancing when the user clicks/presses rapidly. */
let _advancing = false

// ── derived ───────────────────────────────────────────────────────────────────

const totalSteps = computed(() => pendingBatch.value?.questions.length ?? 0)

const currentQuestion = computed(
  () => pendingBatch.value?.questions[step.value] ?? null,
)

/** The index reserved for the free-text input */
const maxIdx = computed(() => currentQuestion.value?.options.length ?? 0)

// ── reset on new batch ────────────────────────────────────────────────────────

watch(
  pendingBatch,
  batch => {
    if (batch) {
      step.value = 0
      localAnswers.value = Array.from<string | null>({ length: batch.questions.length }).fill(null)
      selectedIdx.value = 0
      freeText.value = ''
      _advancing = false
    }
  },
  { immediate: true },
)

// ── step machine ──────────────────────────────────────────────────────────────

async function advance(answer: string | null): Promise<void> {
  if (_advancing || !pendingBatch.value)
    return
  _advancing = true

  localAnswers.value[step.value] = answer

  if (step.value < totalSteps.value - 1) {
    await new Promise(r => setTimeout(r, 90))
    step.value++
    selectedIdx.value = 0
    freeText.value = localAnswers.value[step.value] || ''
    _advancing = false
  }
  else {
    const answers = [...localAnswers.value]
    answers[step.value] = answer
    chat.submitAnswers(chat.activeId, answers)
    // _advancing intentionally left true; the overlay is about to unmount.
  }
}

function goBack() {
  if (step.value > 0) {
    step.value--
    selectedIdx.value = 0
    freeText.value = localAnswers.value[step.value] || ''
  }
}

function goForward() {
  if (step.value < totalSteps.value - 1) {
    step.value++
    selectedIdx.value = 0
    freeText.value = localAnswers.value[step.value] || ''
  }
}

function selectOption(idx: number): void {
  if (!currentQuestion.value)
    return
  selectedIdx.value = idx
  advance(currentQuestion.value.options[idx]!)
}

function confirmFreeText(): void {
  advance(freeText.value.trim() || null)
}

function skipQuestion(): void {
  advance(null)
}

function dismiss(): void {
  chat.dismissQuestions(chat.activeId)
}

// ── free-text focus helper ────────────────────────────────────────────────────

async function focusFreeText(): Promise<void> {
  await nextTick()
  freeTextRef.value?.focus()
}

function onFreeRowClick(): void {
  selectedIdx.value = maxIdx.value
  focusFreeText()
}

// ── keyboard navigation ───────────────────────────────────────────────────────

function onGlobalKeydown(e: KeyboardEvent): void {
  if (!pendingBatch.value)
    return

  const isFreeTextFocused = document.activeElement === freeTextRef.value

  switch (e.key) {
    case 'ArrowUp':
      if (isFreeTextFocused)
        return
      e.preventDefault()
      selectedIdx.value = (selectedIdx.value - 1 + (maxIdx.value + 1)) % (maxIdx.value + 1)
      break

    case 'ArrowDown':
      if (isFreeTextFocused)
        return
      e.preventDefault()
      selectedIdx.value = (selectedIdx.value + 1) % (maxIdx.value + 1)
      break

    case 'Enter':
      if (isFreeTextFocused)
        return
      e.preventDefault()
      if (selectedIdx.value === maxIdx.value) {
        focusFreeText()
      }
      else {
        selectOption(selectedIdx.value)
      }
      break

    case 'Escape':
      if (isFreeTextFocused)
        return
      e.preventDefault()
      skipQuestion()
      break
  }
}

window.addEventListener('keydown', onGlobalKeydown)
onUnmounted(() => window.removeEventListener('keydown', onGlobalKeydown))
</script>

<template>
  <div
    v-if="pendingBatch && currentQuestion"
    class="q-overlay"
    role="dialog"
    aria-modal="false"
    aria-label="Agent question"
  >
    <!-- ── Header bar ──────────────────────────────────────────────── -->
    <div class="q-header">
      <div class="q-header-main">
        <!-- Question text — fades between steps -->
        <Transition name="q-text" mode="out-in">
          <p :key="step" class="q-question-text">
            {{ currentQuestion.question }}
          </p>
        </Transition>
      </div>

      <div class="q-header-end">
        <!-- Pagination (multi-step only) -->
        <div
          v-if="totalSteps > 1"
          class="q-pagination"
          :aria-label="`Question ${step + 1} of ${totalSteps}`"
        >
          <button class="q-page-btn" :disabled="step === 0" @click="goBack">
            <ChevronLeft :size="14" />
          </button>
          <span class="q-page-text">{{ step + 1 }} of {{ totalSteps }}</span>
          <button class="q-page-btn" :disabled="step === totalSteps - 1" @click="goForward">
            <ChevronRight :size="14" />
          </button>
        </div>

        <!-- Dismiss button -->
        <button
          class="q-dismiss-btn"
          aria-label="Dismiss all questions"
          @click="dismiss"
        >
          <X :size="16" :stroke-width="1.5" />
        </button>
      </div>
    </div>

    <!-- ── Options area (transitions between steps) ── -->
    <Transition name="q-step" mode="out-in">
      <div :key="step" class="q-options">
        <!-- Preset Options -->
        <button
          v-for="(option, idx) in currentQuestion.options"
          :key="idx"
          class="q-option"
          :class="{ 'q-option--sel': selectedIdx === idx }"
          @click="selectOption(idx)"
          @mouseenter="selectedIdx = idx"
        >
          <span
            class="q-num"
            :class="{ 'q-num--sel': selectedIdx === idx }"
            aria-hidden="true"
          >{{ idx + 1 }}</span>

          <span class="q-option-label">{{ option }}</span>

          <!-- Keyboard hint -->
          <span class="q-key-hint" aria-hidden="true">↵</span>
        </button>

        <!-- Option: free text -->
        <div
          class="q-option q-option--free"
          :class="{ 'q-option--sel': selectedIdx === maxIdx }"
          role="button"
          tabindex="-1"
          @mouseenter="selectedIdx = maxIdx"
          @click="onFreeRowClick"
        >
          <span class="q-num q-num--pencil" aria-hidden="true">
            <Pencil :size="11" :stroke-width="2.5" />
          </span>

          <input
            ref="freeTextRef"
            v-model="freeText"
            class="q-free-input"
            type="text"
            placeholder="Something else"
            aria-label="Custom answer"
            @focus="selectedIdx = maxIdx"
            @keydown.enter.prevent.stop="confirmFreeText"
            @keydown.escape.prevent.stop="skipQuestion"
          >

          <button
            class="q-skip-btn"
            aria-label="Skip this question"
            @click.stop="skipQuestion"
          >
            Skip
          </button>
        </div>
      </div>
    </Transition>
  </div>
</template>

<style scoped>
/* ── outer shell — detached design ─────────────────────────────────────────── */

.q-overlay {
  width: 100%;
  background: var(--color-bg-card);
  border: 1px solid var(--color-border-bright);
  border-radius: 12px;
  margin-bottom: 8px; /* Adds space above the chat input */
  display: flex;
  flex-direction: column;
  overflow: hidden;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.08); /* Subtle floating shadow */
}

/* ── header ────────────────────────────────────────────────────────────────── */

.q-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 16px 16px 12px 16px;
}

.q-header-main {
  flex: 1;
  display: flex;
  align-items: center;
  min-width: 0;
}

.q-question-text {
  margin: 0;
  font-size: 14px;
  font-weight: 500;
  color: var(--color-text-primary);
  line-height: 1.4;
}

.q-header-end {
  display: flex;
  align-items: center;
  gap: 16px;
  flex-shrink: 0;
}

/* ── pagination ────────────────────────────────────────────────────────────── */

.q-pagination {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  font-weight: 500;
  color: var(--color-text-dim);
}

.q-page-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  padding: 0;
  border: none;
  background: transparent;
  color: inherit;
  cursor: pointer;
  border-radius: 4px;
  transition:
    background 150ms ease,
    color 150ms ease;
}

.q-page-btn:hover:not(:disabled) {
  background: var(--color-bg-hover);
  color: var(--color-text-secondary);
}

.q-page-btn:disabled {
  opacity: 0.3;
  cursor: not-allowed;
}

/* ── dismiss button ────────────────────────────────────────────────────────── */

.q-dismiss-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  padding: 0;
  border: none;
  background: transparent;
  color: var(--color-text-dim);
  cursor: pointer;
  border-radius: 4px;
  transition:
    background 150ms ease,
    color 150ms ease;
}
.q-dismiss-btn:hover {
  background: var(--color-bg-elevated);
  color: var(--color-text-secondary);
}

/* ── options container ─────────────────────────────────────────────────────── */

.q-options {
  display: flex;
  flex-direction: column;
  padding: 0 16px 16px 16px;
  gap: 4px; /* Slight gap separating the options */
}

/* ── option row ────────────────────────────────────────────────────────────── */

.q-option {
  position: relative;
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 6px 8px;
  min-height: 36px;
  border: none;
  border-radius: 8px;
  background: transparent;
  cursor: pointer;
  width: 100%;
  text-align: left;
  transition: background 130ms ease;
}

.q-option:hover:not(.q-option--free),
.q-option--sel:not(.q-option--free) {
  background: var(--color-bg-hover);
}

/* Number badge */
.q-num {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  flex-shrink: 0;
  border-radius: 6px;
  background: var(--color-bg-elevated); /* Solid dark rounded rect */
  font-size: 11px;
  font-weight: 600;
  color: var(--color-text-secondary);
  font-variant-numeric: tabular-nums;
  transition: all 150ms ease;
}

.q-option-label {
  flex: 1;
  font-size: 13px;
  color: var(--color-text-secondary);
  line-height: 1.4;
  transition: color 130ms ease;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.q-option--sel .q-option-label {
  color: var(--color-text-primary);
}

/* Keyboard hint — Enter glyph visible on selection */
.q-key-hint {
  flex-shrink: 0;
  font-size: 11px;
  color: var(--color-text-dim);
  opacity: 0;
  transform: translateX(4px);
  transition:
    opacity 150ms ease,
    transform 150ms ease,
    color 150ms ease;
}
.q-option--sel .q-key-hint {
  opacity: 1;
  transform: translateX(0);
  color: var(--color-accent-dim);
}

/* ── free-text option ──────────────────────────────────────────────────────── */

.q-option--free {
  cursor: default;
  background: var(--color-bg-elevated); /* Distinct raised background block */
  margin-top: 4px; /* Separation from rest of items */
  padding-right: 12px;
}
.q-option--sel.q-option--free {
  /* Subtle highlight when using keyboard to focus the input block */
  background: color-mix(in srgb, var(--color-bg-elevated) 80%, var(--color-accent-muted));
}

.q-num--pencil {
  background: color-mix(in srgb, var(--color-bg-card) 60%, var(--color-bg-elevated));
}

.q-free-input {
  flex: 1;
  min-width: 0;
  background: transparent;
  border: none;
  color: var(--color-text-primary);
  font-size: 13px;
  font-family: inherit;
  caret-color: var(--color-text-primary);
  outline: none;
  cursor: text;
}
.q-free-input::placeholder {
  color: var(--color-text-dim);
  transition: color 150ms ease;
}
.q-option--sel .q-free-input::placeholder {
  color: var(--color-text-tertiary);
}

/* Skip button */
.q-skip-btn {
  height: 24px;
  padding-inline: 12px;
  border: 1px solid var(--color-border-mid);
  border-radius: 6px;
  background: transparent;
  color: var(--color-text-primary);
  font-size: 11px;
  font-weight: 500;
  font-family: inherit;
  cursor: pointer;
  flex-shrink: 0;
  transition: all 150ms ease;
}
.q-skip-btn:hover {
  background: var(--color-bg-hover);
  border-color: var(--color-border-bright);
}

/* ── question text fade between steps ─────────────────────────────────────── */

.q-text-enter-active {
  transition: opacity 140ms ease;
}
.q-text-leave-active {
  transition: opacity 90ms ease;
  position: absolute;
}
.q-text-enter-from,
.q-text-leave-to {
  opacity: 0;
}

/* ── option list slide between steps ──────────────────────────────────────── */

.q-step-enter-active {
  transition:
    opacity 180ms ease,
    transform 180ms ease;
}
.q-step-leave-active {
  transition:
    opacity 100ms ease,
    transform 100ms ease;
}
.q-step-enter-from {
  opacity: 0;
  transform: translateX(12px);
}
.q-step-leave-to {
  opacity: 0;
  transform: translateX(-8px);
}
</style>
