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
import { dismissAll, pendingBatch, submitAnswers } from '@/utils/tools/questions'

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
    // Brief pause so the selection highlight is visible before the transition.
    await new Promise(r => setTimeout(r, 90))
    step.value++
    selectedIdx.value = 0
    freeText.value = ''
    _advancing = false
  }
  else {
    // Last question answered — submit the full batch.
    const answers = [...localAnswers.value]
    answers[step.value] = answer
    submitAnswers(answers)
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
  dismissAll()
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
      // Allow cursor movement inside the text input.
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
      // Free-text input handles its own Enter via @keydown.enter.prevent.stop.
      if (isFreeTextFocused)
        return
      e.preventDefault()
      if (selectedIdx.value === 3) {
        // User navigated to the free-text row via keyboard — focus it.
        focusFreeText()
      }
      else {
        selectOption(selectedIdx.value)
      }
      break

    case 'Escape':
      // Free-text input handles its own Escape via @keydown.escape.prevent.stop.
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
    <!-- ── Header bar (persistent — does not transition between steps) ── -->
    <div class="q-header">
      <Transition name="q-text" mode="out-in">
        <p :key="step" class="q-question-text">
          {{ currentQuestion.question }}
        </p>
      </Transition>

      <div class="q-header-end">
        <span
          v-if="totalSteps > 1"
          class="q-step-badge"
          aria-label="`Question ${step + 1} of ${totalSteps}`"
        >
          {{ step + 1 }}/{{ totalSteps }}
        </span>
        <button
          class="q-dismiss-btn"
          aria-label="Dismiss all questions"
          @click="dismiss"
        >
          <X :size="13" :stroke-width="2" />
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
          <span
            class="q-num"
            :class="{ 'q-num--sel': selectedIdx === idx }"
            aria-hidden="true"
          >{{ idx + 1 }}</span>
          <span class="q-option-label">{{ option }}</span>
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
  border: 1px solid var(--color-border-mid);
  border-bottom: none;
  border-radius: 12px 12px 0 0;
  /* Overlap the input-shell's top border by 1px so the two panels fuse
     into a single continuous bordered rectangle. */
  margin-bottom: -1px;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

/* ── header ────────────────────────────────────────────────────────────────── */

.q-header {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  padding: 14px 14px 12px;
  border-bottom: 1px solid var(--color-border-subtle);
}

.q-question-text {
  flex: 1;
  margin: 0;
  font-size: 13.5px;
  font-weight: 600;
  line-height: 1.5;
  color: var(--color-text-primary);
  /* Prevent layout shift while text fades between steps */
  min-height: 1.5em;
}

.q-header-end {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
  /* Align with the first line of the question text */
  margin-top: 1px;
}

.q-step-badge {
  font-size: 11px;
  font-weight: 500;
  font-variant-numeric: tabular-nums;
  color: var(--color-text-tertiary);
  letter-spacing: 0.02em;
}

.q-dismiss-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  padding: 0;
  border: none;
  border-radius: 5px;
  background: transparent;
  color: var(--color-text-tertiary);
  cursor: pointer;
  transition:
    background 100ms ease,
    color 100ms ease;
}
.q-dismiss-btn:hover {
  background: var(--color-bg-hover);
  color: var(--color-text-secondary);
}

/* ── options ───────────────────────────────────────────────────────────────── */

.q-options {
  display: flex;
  flex-direction: column;
}

.q-option {
  display: flex;
  align-items: center;
  gap: 10px;
  padding-inline: 12px;
  height: 44px;
  border: none;
  border-top: 1px solid var(--color-border-subtle);
  background: transparent;
  cursor: pointer;
  width: 100%;
  text-align: left;
  transition: background 80ms ease;
}
.q-option:first-child {
  border-top: none;
}
.q-option:hover,
.q-option--sel {
  background: var(--color-bg-elevated);
}

/* Number badge (options A–C) */
.q-num {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  flex-shrink: 0;
  border-radius: 5px;
  background: var(--color-bg-elevated);
  border: 1px solid var(--color-border-mid);
  font-size: 11px;
  font-weight: 600;
  color: var(--color-text-tertiary);
  transition:
    background 80ms ease,
    border-color 80ms ease,
    color 80ms ease;
}
.q-num--sel {
  background: var(--color-accent-muted-plus);
  border-color: var(--color-accent-dim);
  color: var(--color-accent-text);
}

.q-option-label {
  flex: 1;
  font-size: 13px;
  color: var(--color-text-secondary);
  line-height: 1.4;
  transition: color 80ms ease;
}
.q-option--sel .q-option-label {
  color: var(--color-text-primary);
}

/* Free-text option (option D) */
.q-option--free {
  cursor: default;
  gap: 8px;
}
.q-pencil {
  flex-shrink: 0;
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
  color: var(--color-text-tertiary);
}

.q-skip-btn {
  height: 22px;
  padding-inline: 10px;
  border: 1px solid var(--color-border-mid);
  border-radius: 5px;
  background: transparent;
  color: var(--color-text-tertiary);
  font-size: 11.5px;
  font-weight: 500;
  font-family: inherit;
  cursor: pointer;
  flex-shrink: 0;
  transition:
    background 100ms ease,
    color 100ms ease,
    border-color 100ms ease;
}
.q-skip-btn:hover {
  background: var(--color-bg-hover);
  color: var(--color-text-secondary);
  border-color: var(--color-border-bright);
}

/* ── overlay entrance / exit (managed by ChatInput's <Transition>) ────────── */
/* These classes are applied on the .q-overlay element by the parent Transition */
/* Nothing to add here — the parent owns the transition CSS */

/* ── question text fade between steps ─────────────────────────────────────── */

.q-text-enter-active {
  transition: opacity 120ms ease;
}
.q-text-leave-active {
  transition: opacity 80ms ease;
  position: absolute;
}
.q-text-enter-from,
.q-text-leave-to {
  opacity: 0;
}

/* ── option list slide between steps ──────────────────────────────────────── */

.q-step-enter-active {
  transition:
    opacity 140ms ease,
    transform 140ms ease;
}
.q-step-leave-active {
  transition: opacity 90ms ease;
}
.q-step-enter-from {
  opacity: 0;
  transform: translateX(10px);
}
.q-step-leave-to {
  opacity: 0;
}
</style>
