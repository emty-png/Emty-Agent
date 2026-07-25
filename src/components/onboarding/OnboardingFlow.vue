<script setup lang="ts">
import { ref } from 'vue'
import StepProject from './StepProject.vue'
import StepProviders from './StepProviders.vue'
import StepStt from './StepStt.vue'
import StepTheme from './StepTheme.vue'
import WelcomeScreen from './WelcomeScreen.vue'

const emit = defineEmits<{ complete: [] }>()

type Phase = 'welcome' | 'wizard'

const phase = ref<Phase>('welcome')
const currentStep = ref(0)

const stepLabels = ['Providers', 'Voice', 'Project', 'Theme']
const totalSteps = stepLabels.length

function goToWizard() {
  phase.value = 'wizard'
  currentStep.value = 0
}

function nextStep() {
  if (currentStep.value < totalSteps - 1)
    currentStep.value++
  else
    emit('complete')
}

function finish() {
  emit('complete')
}
</script>

<template>
  <div class="onboarding-root">
    <!-- Welcome phase -->
    <Transition name="fade" mode="out-in">
      <WelcomeScreen v-if="phase === 'welcome'" @next="goToWizard" />

      <!-- Wizard phase -->
      <div v-else class="wizard-root">
        <!-- Progress bar -->
        <div class="progress-bar">
          <div
            v-for="(label, i) in stepLabels"
            :key="i"
            class="progress-step"
          >
            <div
              class="progress-dot"
              :class="{
                done: i < currentStep,
                active: i === currentStep,
              }"
            >
              <span v-if="i < currentStep" class="progress-check">&#10003;</span>
              <span v-else>{{ i + 1 }}</span>
            </div>
            <span class="progress-label" :class="{ active: i === currentStep }">{{ label }}</span>
            <div v-if="i < totalSteps - 1" class="progress-line" :class="{ done: i < currentStep }" />
          </div>
        </div>

        <!-- Step content -->
        <div class="step-container">
          <Transition name="step-fade" mode="out-in">
            <StepProviders v-if="currentStep === 0" key="providers" @next="nextStep" />
            <StepStt v-else-if="currentStep === 1" key="stt" @next="nextStep" />
            <StepProject v-else-if="currentStep === 2" key="project" @next="nextStep" />
            <StepTheme v-else-if="currentStep === 3" key="theme" @finish="finish" />
          </Transition>
        </div>
      </div>
    </Transition>
  </div>
</template>

<style scoped>
.onboarding-root {
  width: 100%;
  height: 100%;
  background: var(--color-bg-base);
  display: flex;
  flex-direction: column;
}

/* ── Welcome transition ────────────────────────────────────────────── */
.fade-enter-active,
.fade-leave-active {
  transition: opacity 300ms ease;
}

.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}

/* ── Step transition ───────────────────────────────────────────────── */
.step-fade-enter-active {
  transition: opacity 200ms ease 50ms;
}

.step-fade-leave-active {
  transition: opacity 150ms ease;
}

.step-fade-enter-from,
.step-fade-leave-to {
  opacity: 0;
}

/* ── Wizard layout ─────────────────────────────────────────────────── */
.wizard-root {
  display: flex;
  flex-direction: column;
  height: 100%;
  padding: 24px 32px;
}

/* ── Progress bar ──────────────────────────────────────────────────── */
.progress-bar {
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  padding-bottom: 24px;
  width: 100%;
}

.progress-step {
  display: flex;
  align-items: center;
  gap: 10px;
}

.progress-dot {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border-radius: 50%;
  border: 2px solid var(--color-border-mid);
  background: var(--color-bg-card);
  color: var(--color-text-tertiary);
  font-size: 13px;
  font-weight: 600;
  flex-shrink: 0;
  transition: all 200ms ease;
}

.progress-dot.active {
  border-color: var(--color-accent);
  background: color-mix(in srgb, var(--color-accent) 15%, transparent);
  color: var(--color-accent);
}

.progress-dot.done {
  border-color: var(--color-accent);
  background: color-mix(in srgb, var(--color-accent) 20%, transparent);
  color: var(--color-accent);
}

.progress-check {
  font-size: 13px;
}

.progress-label {
  font-size: 13px;
  font-weight: 500;
  color: var(--color-text-tertiary);
  white-space: nowrap;
  transition: color 200ms ease;
}

.progress-label.active {
  color: var(--color-text-primary);
}

.progress-line {
  flex: 1;
  height: 3px;
  min-width: 40px;
  max-width: 140px;
  background: var(--color-border-mid);
  margin: 0 16px;
  border-radius: 2px;
  transition: background 200ms ease;
}

.progress-line.done {
  background: var(--color-accent);
}

/* ── Step container ────────────────────────────────────────────────── */
.step-container {
  flex: 1;
  overflow: hidden;
  background: var(--color-bg-card);
  border: 1px solid var(--color-border-mid);
  border-radius: var(--radius-lg);
  padding: 24px;
  box-shadow: var(--color-shadow-sm);
}
</style>
