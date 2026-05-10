<script setup lang="ts">
/**
 * QuestionOverlay.vue
 *
 * Renders the ask_questions UI above the chat input.
 * Reads pendingBatch directly from the questions module — no props needed.
 *
 * Step machine:
 *   • The user is shown one question at a time.
 *   • Options 1–3 are clickable buttons; pressing one immediately advances.
 *   • Option 4 is a free-text input. The user types then presses Enter to confirm.
 *   • Esc or the Skip button marks the current question as "skipped" and advances.
 *   • The × button in the header dismisses all remaining questions as "skipped".
 *   • After the last question, submitAnswers() resolves the tool Promise.
 *
 * Keyboard navigation:
 *   ↑ / ↓ — move between options (wraps, 0–3)
 *   Enter  — confirm selection; if on free-text row, focus the input first,
 *             then Enter in the input submits the text
 *   Esc    — skip current question and advance
 */

import { Pencil, X } from 'lucide-vue-next'
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
 *   0 = option A (first preset)
 *   1 = option B
 *   2 = option C
 *   3 = free-text row
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
    freeText.value = ''
    _advancing = false
  }
  else {
    const answers = [...localAnswers.value]
    answers[step.value] = answer
    chat.submitAnswers(chat.activeId, answers)
    // _advancing intentionally left true; the overlay is about to unmount.
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
  selectedIdx.value = 3
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
      selectedIdx.value = (selectedIdx.value - 1 + 4) % 4
      break

    case 'ArrowDown':
      if (isFreeTextFocused)
        return
      e.preventDefault()
      selectedIdx.value = (selectedIdx.value + 1) % 4
      break

    case 'Enter':
      if (isFreeTextFocused)
        return
      e.preventDefault()
      if (selectedIdx.value === 3) {
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
    <!-- ── Accent strip ──────────────────────────────────────────────── -->

    <!-- ── Header bar ──────────────────────────────────────────────── -->
    <div class="q-header">
      <div class="q-header-main">
        <!-- Label chip -->
        <span class="q-label-chip" aria-hidden="true">Q</span>

        <!-- Question text — fades between steps -->
        <Transition name="q-text" mode="out-in">
          <p :key="step" class="q-question-text">
            {{ currentQuestion.question }}
          </p>
        </Transition>
      </div>

      <div class="q-header-end">
        <!-- Progress dots (multi-step only) -->
        <div
          v-if="totalSteps > 1"
          class="q-dots"
          :aria-label="`Question ${step + 1} of ${totalSteps}`"
        >
          <span
            v-for="i in totalSteps"
            :key="i"
            class="q-dot"
            :class="{
              'q-dot--done': i - 1 < step,
              'q-dot--active': i - 1 === step,
            }"
          />
        </div>

        <!-- Dismiss button -->
        <button
          class="q-dismiss-btn"
          aria-label="Dismiss all questions"
          @click="dismiss"
        >
          <X :size="12" :stroke-width="2.2" />
        </button>
      </div>
    </div>

    <!-- ── Options area (transitions between steps) ── -->
    <Transition name="q-step" mode="out-in">
      <div :key="step" class="q-options">
        <!-- Options A, B, C -->
        <button
          v-for="(option, idx) in currentQuestion.options"
          :key="idx"
          class="q-option"
          :class="{ 'q-option--sel': selectedIdx === idx }"
          @click="selectOption(idx)"
          @mouseenter="selectedIdx = idx"
        >
          <!-- Left accent sliver -->
          <span class="q-option-accent" aria-hidden="true" />

          <span
            class="q-num"
            :class="{ 'q-num--sel': selectedIdx === idx }"
            aria-hidden="true"
          >{{ idx + 1 }}</span>

          <span class="q-option-label">{{ option }}</span>

          <!-- Keyboard hint -->
          <span class="q-key-hint" aria-hidden="true">↵</span>
        </button>

        <!-- Option D: free text -->
        <div
          class="q-option q-option--free"
          :class="{ 'q-option--sel': selectedIdx === 3 }"
          role="button"
          tabindex="-1"
          @mouseenter="selectedIdx = 3"
          @click="onFreeRowClick"
        >
          <!-- Left accent sliver -->
          <span class="q-option-accent" aria-hidden="true" />

          <Pencil
            :size="12"
            :stroke-width="1.8"
            class="q-pencil"
            aria-hidden="true"
          />

          <input
            ref="freeTextRef"
            v-model="freeText"
            class="q-free-input"
            type="text"
            placeholder="Something else…"
            aria-label="Custom answer"
            @focus="selectedIdx = 3"
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
/* ── outer shell ───────────────────────────────────────────────────────────── */

.q-overlay {
  width: 100%;
  background: var(--color-bg-card);
  border: 1px solid var(--color-border-bright);
  border-bottom: none;
  border-radius: 12px 12px 0 0;
  margin-bottom: -1px;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  /* Subtle ambient glow from the accent strip */
  box-shadow: 0 -4px 20px -6px color-mix(in srgb, var(--color-accent) 12%, transparent);
}

/* ── top accent strip — removed */

/* ── header ────────────────────────────────────────────────────────────────── */

.q-header {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 13px 13px 11px;
  border-bottom: 1px solid var(--color-border-mid);
}

.q-header-main {
  flex: 1;
  display: flex;
  align-items: flex-start;
  gap: 9px;
  min-width: 0;
}

/* "Q" chip label */
.q-label-chip {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  width: 18px;
  height: 18px;
  margin-top: 1px;
  border-radius: 5px;
  background: var(--color-accent-muted-plus);
  border: 1px solid color-mix(in srgb, var(--color-accent) 30%, transparent);
  font-size: 10px;
  font-weight: 800;
  letter-spacing: 0;
  color: var(--color-accent-text);
  user-select: none;
}

.q-question-text {
  flex: 1;
  margin: 0;
  font-size: 13.5px;
  font-weight: 600;
  line-height: 1.5;
  color: var(--color-text-primary);
  min-height: 1.5em;
}

.q-header-end {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
  margin-top: 2px;
}

/* ── progress dots ─────────────────────────────────────────────────────────── */

.q-dots {
  display: flex;
  align-items: center;
  gap: 4px;
}

.q-dot {
  width: 5px;
  height: 5px;
  border-radius: var(--radius-pill);
  background: var(--color-border-bright);
  transition:
    background 300ms cubic-bezier(0.4, 0, 0.2, 1),
    width 300ms cubic-bezier(0.4, 0, 0.2, 1),
    opacity 300ms ease;
}

.q-dot--done {
  background: color-mix(in srgb, var(--color-success) 70%, var(--color-border-mid));
}

.q-dot--active {
  width: 14px;
  background: var(--color-accent);
}

/* ── dismiss button ─────────────────────────────────────────────────────────── */

.q-dismiss-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  padding: 0;
  border: 1px solid transparent;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--color-text-dim);
  cursor: pointer;
  transition:
    background 150ms cubic-bezier(0.4, 0, 0.2, 1),
    color 150ms ease,
    border-color 150ms ease;
}
.q-dismiss-btn:hover {
  background: var(--color-bg-elevated);
  color: var(--color-text-secondary);
  border-color: var(--color-border-mid);
}

/* ── options container ─────────────────────────────────────────────────────── */

.q-options {
  display: flex;
  flex-direction: column;
}

/* ── option row ────────────────────────────────────────────────────────────── */

.q-option {
  position: relative;
  display: flex;
  align-items: center;
  gap: 10px;
  padding-inline: 13px;
  height: 42px;
  border: none;
  border-top: 1px solid var(--color-border-mid);
  background: transparent;
  cursor: pointer;
  width: 100%;
  text-align: left;
  transition: background 130ms cubic-bezier(0.4, 0, 0.2, 1);
  overflow: hidden;
}
.q-option:first-child {
  border-top: none;
}

/* Left accent sliver — shown when selected */
.q-option-accent {
  position: absolute;
  left: 0;
  top: 50%;
  transform: translateY(-50%) scaleY(0);
  transform-origin: center;
  width: 2px;
  height: 55%;
  min-height: 14px;
  border-radius: var(--radius-pill);
  background: var(--color-accent);
  transition: transform 180ms cubic-bezier(0.34, 1.56, 0.64, 1);
}
.q-option--sel .q-option-accent {
  transform: translateY(-50%) scaleY(1);
}

.q-option--sel {
  background: color-mix(in srgb, var(--color-bg-elevated) 80%, var(--color-accent-muted));
}
.q-option:hover:not(.q-option--sel) {
  background: var(--color-bg-elevated);
}

/* Number badge */
.q-num {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 19px;
  height: 19px;
  flex-shrink: 0;
  border-radius: 5px;
  background: var(--color-bg-elevated);
  border: 1px solid var(--color-border-mid);
  font-size: 10.5px;
  font-weight: 700;
  color: var(--color-text-tertiary);
  font-variant-numeric: tabular-nums;
  transition:
    background 150ms cubic-bezier(0.4, 0, 0.2, 1),
    border-color 150ms ease,
    color 150ms ease,
    transform 150ms cubic-bezier(0.34, 1.56, 0.64, 1);
}
.q-num--sel {
  background: var(--color-accent-muted-plus);
  border-color: color-mix(in srgb, var(--color-accent) 45%, transparent);
  color: var(--color-accent-text);
  transform: scale(1.08);
}

.q-option-label {
  flex: 1;
  font-size: 13px;
  color: var(--color-text-secondary);
  line-height: 1.4;
  transition: color 130ms ease;
  /* Prevent long labels from squishing the key hint */
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
    transform 150ms cubic-bezier(0.4, 0, 0.2, 1),
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
  gap: 8px;
  height: 40px;
}

.q-pencil {
  flex-shrink: 0;
  color: var(--color-text-dim);
  transition: color 150ms ease;
}
.q-option--sel .q-pencil {
  color: var(--color-text-tertiary);
}

.q-free-input {
  flex: 1;
  min-width: 0;
  background: transparent;
  border: none;
  color: var(--color-text-primary);
  font-size: 13px;
  font-family: inherit;
  caret-color: var(--color-accent-bright);
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
  height: 20px;
  padding-inline: 9px;
  border: 1px solid var(--color-border-mid);
  border-radius: var(--radius-pill);
  background: transparent;
  color: var(--color-text-dim);
  font-size: 11px;
  font-weight: 500;
  font-family: inherit;
  cursor: pointer;
  flex-shrink: 0;
  letter-spacing: 0.02em;
  transition:
    background 150ms cubic-bezier(0.4, 0, 0.2, 1),
    color 150ms ease,
    border-color 150ms ease;
}
.q-skip-btn:hover {
  background: var(--color-bg-elevated);
  color: var(--color-text-secondary);
  border-color: var(--color-border-bright);
}

/* ── question text fade between steps ─────────────────────────────────────── */

.q-text-enter-active {
  transition: opacity 140ms cubic-bezier(0.4, 0, 0.2, 1);
}
.q-text-leave-active {
  transition: opacity 90ms cubic-bezier(0.4, 0, 1, 1);
  position: absolute;
}
.q-text-enter-from,
.q-text-leave-to {
  opacity: 0;
}

/* ── option list slide between steps ──────────────────────────────────────── */

.q-step-enter-active {
  transition:
    opacity 180ms cubic-bezier(0.4, 0, 0.2, 1),
    transform 180ms cubic-bezier(0.4, 0, 0.2, 1);
}
.q-step-leave-active {
  transition:
    opacity 100ms cubic-bezier(0.4, 0, 1, 1),
    transform 100ms cubic-bezier(0.4, 0, 1, 1);
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
