<script setup lang="ts">
import { ChevronLeft, ChevronRight, Pencil, X } from 'lucide-vue-next'
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { useChatStore } from '@/stores/chat'

const chat = useChatStore()
const pendingBatch = computed(() => chat.activeTab.pendingQuestions)

// Index of the question currently being displayed (0-based).
const step = ref(0)

/** Collected answers, one slot per question. null = not yet answered. */
const localAnswers = ref<Array<string | null>>([])

// 0..N-1 = preset option rows, N = free-text row
const selectedIdx = ref(0)

const freeText = ref('')

const freeTextRef = ref<HTMLInputElement | null>(null)

/** Prevents double-advancing when the user clicks/presses rapidly. */
const advancing = ref(false)

const totalSteps = computed(() => pendingBatch.value?.questions.length ?? 0)

const currentQuestion = computed(
  () => pendingBatch.value?.questions[step.value] ?? null,
)

const maxIdx = computed(() => currentQuestion.value?.options.length ?? 0)

watch(
  pendingBatch,
  batch => {
    if (batch) {
      step.value = 0
      localAnswers.value = Array.from<string | null>({ length: batch.questions.length }).fill(null)
      selectedIdx.value = 0
      freeText.value = ''
      advancing.value = false
    }
  },
  { immediate: true },
)

async function advance(answer: string | null): Promise<void> {
  if (advancing.value || !pendingBatch.value)
    return
  advancing.value = true

  localAnswers.value[step.value] = answer

  if (step.value < totalSteps.value - 1) {
    await new Promise(r => setTimeout(r, 90))
    step.value++
    selectedIdx.value = 0
    freeText.value = localAnswers.value[step.value] || ''
    advancing.value = false
  }
  else {
    const answers = [...localAnswers.value]
    answers[step.value] = answer
    chat.submitAnswers(chat.activeId, answers)
    // advancing intentionally left true; the overlay is about to unmount.
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

async function focusFreeText(): Promise<void> {
  await nextTick()
  freeTextRef.value?.focus()
}

function onFreeRowClick(): void {
  selectedIdx.value = maxIdx.value
  focusFreeText()
}

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

onMounted(() => {
  window.addEventListener('keydown', onGlobalKeydown)
})
onUnmounted(() => window.removeEventListener('keydown', onGlobalKeydown))

const rootClasses = 'w-full mb-2 bg-(--color-bg-card) border border-(--color-border-bright) rounded-(--radius-lg) flex flex-col overflow-hidden'

const headerClasses = 'flex items-center justify-between gap-2.5 px-4 pt-4 pb-3'
const headerMainClasses = 'flex-1 flex items-center min-w-0'
const questionTextClasses = 'm-0 text-sm font-medium text-(--color-text-primary) leading-[1.4]'
const headerEndClasses = 'flex items-center gap-4 shrink-0'

const paginationClasses = 'flex items-center gap-1.5 text-xs font-medium text-(--color-text-dim)'
const pageBtnClasses = 'flex items-center justify-center w-5 h-5 p-0 border-none bg-transparent text-inherit cursor-pointer rounded-(--radius-xs) transition-[background,color] duration-150 ease-[ease] enabled:hover:bg-(--color-state-hover) enabled:hover:text-(--color-text-secondary) disabled:opacity-30 disabled:cursor-not-allowed'

const dismissBtnClasses = 'flex items-center justify-center w-[22px] h-[22px] p-0 border-none bg-transparent text-(--color-text-dim) cursor-pointer rounded-(--radius-xs) transition-[background,color] duration-150 ease-[ease] hover:bg-(--color-state-hover) hover:text-(--color-text-secondary)'

const optionsClasses = 'flex flex-col px-4 pb-4 gap-1'

function getOptionClasses(selected: boolean): string {
  const base = 'relative flex items-center gap-3 py-1.5 px-2 min-h-9 border-none rounded-(--radius-md) bg-transparent cursor-pointer w-full text-left transition-[background] duration-[130ms] ease-[ease] hover:bg-(--color-state-hover)'
  return selected ? `${base} bg-(--color-state-hover)` : base
}

function getNumClasses(): string {
  return 'flex items-center justify-center w-6 h-6 shrink-0 rounded-(--radius-sm) bg-(--color-state-hover) text-[11px] font-semibold text-(--color-text-secondary) [font-variant-numeric:tabular-nums] transition-all duration-150 ease-[ease]'
}

function getLabelClasses(selected: boolean): string {
  const base = 'flex-1 text-[13px] leading-[1.4] transition-colors duration-[130ms] ease-[ease] truncate'
  const color = selected ? 'text-(--color-text-primary)' : 'text-(--color-text-secondary)'
  return `${base} ${color}`
}

function getKeyHintClasses(selected: boolean): string {
  const base = 'shrink-0 text-[11px] transition-[opacity,transform,color] duration-150 ease-[ease]'
  return selected
    ? `${base} opacity-100 translate-x-0 text-(--color-accent-dim)`
    : `${base} opacity-0 translate-x-1 text-(--color-text-dim)`
}

const freeRowClasses = computed(() => {
  const base = 'relative flex items-center gap-3 py-1.5 pl-2 pr-3 min-h-9 rounded-(--radius-md) cursor-default w-full text-left mt-1 transition-[background] duration-[130ms] ease-[ease]'
  const selected = selectedIdx.value === maxIdx.value
  const bg = selected
    ? 'bg-[color-mix(in_srgb,var(--color-state-hover)_80%,var(--color-accent-muted))]'
    : 'bg-(--color-state-hover)'
  return `${base} ${bg}`
})

const pencilNumClasses = 'flex items-center justify-center w-6 h-6 shrink-0 rounded-(--radius-sm) bg-[color-mix(in_srgb,var(--color-bg-card)_60%,var(--color-bg-elevated))] text-[11px] font-semibold text-(--color-text-secondary) [font-variant-numeric:tabular-nums] transition-all duration-150 ease-[ease]'

const freeInputClasses = computed(() => {
  const base = 'flex-1 min-w-0 bg-transparent border-none text-(--color-text-primary) text-[13px] font-[inherit] caret-(--color-text-primary) outline-none cursor-text placeholder:transition-colors placeholder:duration-150 placeholder:ease-[ease]'
  const placeholder = selectedIdx.value === maxIdx.value
    ? 'placeholder:text-(--color-text-tertiary)'
    : 'placeholder:text-(--color-text-dim)'
  return `${base} ${placeholder}`
})

const skipBtnClasses = 'h-6 px-3 border border-(--color-border-mid) rounded-(--radius-sm) bg-transparent text-(--color-text-primary) text-[11px] font-medium font-[inherit] cursor-pointer shrink-0 transition-all duration-150 ease-[ease] hover:bg-(--color-state-hover) hover:border-(--color-border-bright)'

const textTransitions = {
  enterActiveClass: 'transition-opacity duration-[140ms] ease-[ease]',
  leaveActiveClass: 'transition-opacity duration-[90ms] ease-[ease] absolute',
  enterFromClass: 'opacity-0',
  leaveToClass: 'opacity-0',
}

const stepTransitions = {
  enterActiveClass: 'transition-[opacity,transform] duration-[180ms] ease-[ease]',
  leaveActiveClass: 'transition-[opacity,transform] duration-[100ms] ease-[ease]',
  enterFromClass: 'opacity-0 translate-x-3',
  leaveToClass: 'opacity-0 -translate-x-2',
}
</script>

<template>
  <div
    v-if="pendingBatch && currentQuestion"
    :class="rootClasses"
    role="dialog"
    aria-modal="false"
    aria-label="Agent question"
  >
    <div :class="headerClasses">
      <div :class="headerMainClasses">
        <Transition v-bind="textTransitions" mode="out-in">
          <p :key="step" :class="questionTextClasses">
            {{ currentQuestion.question }}
          </p>
        </Transition>
      </div>

      <div :class="headerEndClasses">
        <div
          v-if="totalSteps > 1"
          :class="paginationClasses"
          :aria-label="`Question ${step + 1} of ${totalSteps}`"
        >
          <button :class="pageBtnClasses" :disabled="step === 0" @click="goBack">
            <ChevronLeft :size="14" />
          </button>
          <span>{{ step + 1 }} of {{ totalSteps }}</span>
          <button :class="pageBtnClasses" :disabled="step === totalSteps - 1" @click="goForward">
            <ChevronRight :size="14" />
          </button>
        </div>

        <!-- Dismiss button -->
        <button
          :class="dismissBtnClasses"
          aria-label="Dismiss all questions"
          @click="dismiss"
        >
          <X :size="16" :stroke-width="1.5" />
        </button>
      </div>
    </div>

    <!-- ── Options area (transitions between steps) ── -->
    <Transition v-bind="stepTransitions" mode="out-in">
      <div :key="step" :class="optionsClasses">
        <!-- Preset Options -->
        <button
          v-for="(option, idx) in currentQuestion.options"
          :key="idx"
          :class="getOptionClasses(selectedIdx === idx)"
          @click="selectOption(idx)"
          @mouseenter="selectedIdx = idx"
        >
          <span
            :class="getNumClasses()"
            aria-hidden="true"
          >{{ idx + 1 }}</span>

          <span :class="getLabelClasses(selectedIdx === idx)">{{ option }}</span>

          <!-- Keyboard hint -->
          <span :class="getKeyHintClasses(selectedIdx === idx)" aria-hidden="true">↵</span>
        </button>

        <!-- Option: free text -->
        <div
          :class="freeRowClasses"
          role="button"
          tabindex="-1"
          @mouseenter="selectedIdx = maxIdx"
          @click="onFreeRowClick"
        >
          <span :class="pencilNumClasses" aria-hidden="true">
            <Pencil :size="11" :stroke-width="2.5" />
          </span>

          <input
            ref="freeTextRef"
            v-model="freeText"
            :class="freeInputClasses"
            type="text"
            placeholder="Something else"
            aria-label="Custom answer"
            @focus="selectedIdx = maxIdx"
            @keydown.enter.prevent.stop="confirmFreeText"
            @keydown.escape.prevent.stop="skipQuestion"
          >

          <button
            :class="skipBtnClasses"
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
