<script setup lang="ts">
import { Check, Plus } from 'lucide-vue-next'
import { computed, ref, watch } from 'vue'
import BuiltInProviders from '@/components/settings/providers/BuiltInProviders.vue'
import CompatibleProviders from '@/components/settings/providers/CompatibleProviders.vue'
import ProviderBrowser from '@/components/settings/providers/ProviderBrowser.vue'
import VoiceProviders from '@/components/settings/providers/VoiceProviders.vue'
import { useOnboardingStore } from '@/stores/onboarding'
import { useSettingsStore } from '@/stores/settings'
import { DEFAULT_RADIUS, useThemeStore } from '@/stores/themes'

const onboarding = useOnboardingStore()
const settings = useSettingsStore()
const themeStore = useThemeStore()

const showWelcome = ref(false)
const showContinue = ref(false)
const step = ref<0 | 1 | 2 | 3 | 4>(0)
const showBigOne = ref(false)
const showIndicator = ref(false)
const showProviders = ref(false)
const showProviderBrowser = ref(false)
const isTransitioning = ref(false)

const hasProviderConfigured = computed(() => {
  const hasBuiltIn = [settings.openai, settings.anthropic, settings.google].some(
    p => p.apiKey.trim().length > 0,
  )
  const hasCompatible = settings.compatibleProviders.length > 0
  const hasAnyOk = [settings.openai.status, settings.anthropic.status, settings.google.status].includes(
    'ok',
  ) || settings.compatibleProviders.some(p => p.status === 'ok')
  return hasBuiltIn || hasCompatible || hasAnyOk
})

const hasSttConfigured = computed(() => {
  const stt = settings.stt[settings.sttProvider]
  if (!stt)
    return false
  if (settings.sttProvider === 'custom')
    return stt.apiKey.trim().length > 0 && stt.baseUrl.trim().length > 0
  return stt.apiKey.trim().length > 0
})

const themeList = computed(() => themeStore.themes)

function currentRadius(key: string): number {
  const override = themeStore.themeOverrides[themeStore.activeTheme]?.radius?.[key]
  if (override !== undefined)
    return override
  return DEFAULT_RADIUS[key] ?? 6
}

function onRadiusInput(key: string, e: Event) {
  themeStore.setRadiusOverride(key, Number((e.target as HTMLInputElement).value))
}

let tWelcome: ReturnType<typeof setTimeout> | undefined
let tContinue: ReturnType<typeof setTimeout> | undefined
let tBigOne: ReturnType<typeof setTimeout> | undefined
let tIndicator: ReturnType<typeof setTimeout> | undefined
let tProviders: ReturnType<typeof setTimeout> | undefined

function clearTimers() {
  clearTimeout(tWelcome)
  clearTimeout(tContinue)
  clearTimeout(tBigOne)
  clearTimeout(tIndicator)
  clearTimeout(tProviders)
}

function scheduleContent() {
  clearTimers()
  showWelcome.value = false
  showContinue.value = false
  showBigOne.value = false
  showIndicator.value = false
  showProviders.value = false
  step.value = 0
  tWelcome = setTimeout(() => {
    showWelcome.value = true
  }, 600)
  tContinue = setTimeout(() => {
    showContinue.value = true
  }, 920)
}

function goToStepOne() {
  clearTimers()
  showWelcome.value = false
  showContinue.value = false
  setTimeout(() => {
    step.value = 1
    requestAnimationFrame(() => {
      showBigOne.value = true
      tIndicator = setTimeout(() => {
        showIndicator.value = true
        tProviders = setTimeout(() => {
          showProviders.value = true
        }, 360)
      }, 1280)
    })
  }, 220)
}

function goToStepTwo() {
  if (!hasProviderConfigured.value || isTransitioning.value)
    return
  isTransitioning.value = true
  showProviders.value = false
  setTimeout(() => {
    step.value = 2
    isTransitioning.value = false
  }, 420)
}

function goToStepThree() {
  if (!hasSttConfigured.value || isTransitioning.value)
    return
  isTransitioning.value = true
  showProviders.value = false
  setTimeout(() => {
    step.value = 3
    isTransitioning.value = false
  }, 420)
}

function goToStepFour() {
  if (isTransitioning.value)
    return
  isTransitioning.value = true
  setTimeout(() => {
    step.value = 4
    isTransitioning.value = false
  }, 300)
}

function finishOnboarding() {
  onboarding.hide()
}

watch(() => onboarding.visible, isVisible => {
  clearTimers()
  if (isVisible) {
    scheduleContent()
  }
  else {
    showWelcome.value = false
    showContinue.value = false
    showBigOne.value = false
    showIndicator.value = false
    showProviders.value = false
    step.value = 0
  }
}, { immediate: true })

watch(() => onboarding.generation, () => {
  if (onboarding.visible) {
    scheduleContent()
  }
})
</script>

<template>
  <div class="flex h-full w-full flex-col bg-[var(--color-bg-surface)]">
    <div v-if="step === 0" class="flex flex-1 flex-col items-center justify-center p-8">
      <div class="flex w-full max-w-[320px] flex-col items-center gap-8">
        <Transition name="welcome-content-fade">
          <div v-if="showWelcome" class="flex flex-col items-center gap-3 text-center">
            <h1 class="text-[22px] font-semibold leading-tight tracking-tight text-[var(--color-text-primary)]">
              Welcome to Emty Agent
            </h1>
            <p class="text-[13.5px] leading-[1.6] text-[var(--color-text-secondary)]">
              A nothing-special coding agent.
            </p>
          </div>
        </Transition>

        <Transition name="welcome-content-fade">
          <div v-if="showContinue" class="flex w-full gap-3">
            <button
              class="inline-flex h-9 flex-1 items-center justify-center rounded-[var(--radius-md)] border border-[var(--color-border-mid)] bg-transparent px-6 text-[13px] font-medium text-[var(--color-text-secondary)] transition-[opacity,transform,background] duration-150 hover:bg-[var(--color-bg-elevated)] hover:text-[var(--color-text-primary)] active:scale-[0.98]"
              @click="onboarding.hide()"
            >
              Skip
            </button>
            <button
              class="inline-flex h-9 flex-1 items-center justify-center rounded-[var(--radius-md)] bg-[var(--color-text-primary)] px-6 text-[13px] font-medium text-[var(--color-bg-base)] transition-[opacity,transform] duration-150 hover:opacity-90 active:scale-[0.98]"
              @click="goToStepOne"
            >
              Continue
            </button>
          </div>
        </Transition>
      </div>
    </div>

    <div v-else class="flex flex-1 flex-col overflow-hidden">
      <div class="step-one-stage flex h-full w-full flex-col">
        <Transition name="big-one-fade">
          <span v-if="showBigOne && !showIndicator" key="big-one" class="one-char">1</span>
        </Transition>

        <Transition name="indicator-fade">
          <div v-if="showIndicator" class="flex w-full shrink-0 items-center px-6 pt-6">
            <div class="flex w-full items-center">
              <div
                class="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border text-[13px] font-semibold leading-none transition-colors duration-300"
                :class="step >= 2 ? 'border-[var(--color-text-primary)] bg-[var(--color-text-primary)] text-[var(--color-bg-base)]' : 'border-[var(--color-text-primary)] bg-[var(--color-text-primary)] text-[var(--color-bg-base)]'"
              >
                <Check v-if="step >= 2" :size="14" :stroke-width="2.5" />
                <span v-else>1</span>
              </div>
              <div
                class="h-px flex-1 transition-colors duration-300"
                :class="step >= 2 ? 'bg-[var(--color-text-primary)]' : 'bg-[var(--color-border-mid)]'"
              />
              <div
                class="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border text-[13px] font-semibold leading-none transition-colors duration-300"
                :class="step >= 3 ? 'border-[var(--color-text-primary)] bg-[var(--color-text-primary)] text-[var(--color-bg-base)]' : step >= 2 ? 'border-[var(--color-text-primary)] bg-[var(--color-text-primary)] text-[var(--color-bg-base)]' : 'border-[var(--color-border-mid)] bg-transparent text-[var(--color-text-tertiary)]'"
              >
                <Check v-if="step >= 3" :size="14" :stroke-width="2.5" />
                <span v-else>2</span>
              </div>
              <div
                class="h-px flex-1 transition-colors duration-300"
                :class="step >= 3 ? 'bg-[var(--color-text-primary)]' : 'bg-[var(--color-border-mid)]'"
              />
              <div
                class="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border text-[13px] font-semibold leading-none transition-colors duration-300"
                :class="step >= 4 ? 'border-[var(--color-text-primary)] bg-[var(--color-text-primary)] text-[var(--color-bg-base)]' : step >= 3 ? 'border-[var(--color-text-primary)] bg-[var(--color-text-primary)] text-[var(--color-bg-base)]' : 'border-[var(--color-border-mid)] bg-transparent text-[var(--color-text-tertiary)]'"
              >
                <Check v-if="step >= 4" :size="14" :stroke-width="2.5" />
                <span v-else>3</span>
              </div>
              <div
                class="h-px flex-1 transition-colors duration-300"
                :class="step >= 4 ? 'bg-[var(--color-text-primary)]' : 'bg-[var(--color-border-mid)]'"
              />
              <div
                class="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border text-[13px] font-semibold leading-none transition-colors duration-300"
                :class="step >= 4 ? 'border-[var(--color-text-primary)] bg-[var(--color-text-primary)] text-[var(--color-bg-base)]' : 'border-[var(--color-border-mid)] bg-transparent text-[var(--color-text-tertiary)]'"
              >
                4
              </div>
            </div>
          </div>
        </Transition>

        <Transition name="providers-fade">
          <div v-if="showProviders && step === 1" class="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-6 pb-6 pt-4">
            <h2 class="text-center text-[17px] font-semibold tracking-tight text-[var(--color-text-primary)]">
              Configure Chat Providers
            </h2>
            <div class="flex min-w-0 flex-col gap-3">
              <BuiltInProviders />
              <div v-if="settings.compatibleProviders.length > 0" class="text-[12px] font-medium text-[var(--color-text-tertiary)]">
                Already configured ({{ settings.compatibleProviders.length }})
              </div>
              <CompatibleProviders v-if="settings.compatibleProviders.length > 0" />
              <div class="add-provider-card" @click="showProviderBrowser = true">
                <div class="add-provider-icon">
                  <Plus :size="20" :stroke-width="1.8" />
                </div>
                <div class="add-provider-text">
                  <span class="add-provider-title">More Providers</span>
                  <span class="add-provider-desc">Browse 130+ OpenAI-compatible providers</span>
                </div>
              </div>
            </div>
            <div class="mt-2 flex gap-3">
              <button
                class="inline-flex h-9 flex-1 items-center justify-center rounded-[var(--radius-md)] border border-[var(--color-border-mid)] bg-transparent px-6 text-[13px] font-medium text-[var(--color-text-secondary)] transition-[opacity,transform,background] duration-150 hover:bg-[var(--color-bg-elevated)] hover:text-[var(--color-text-primary)] active:scale-[0.98]"
                @click="onboarding.hide()"
              >
                Skip
              </button>
              <button
                class="inline-flex h-9 flex-1 items-center justify-center rounded-[var(--radius-md)] px-6 text-[13px] font-medium transition-[opacity,transform,background] duration-150 active:scale-[0.98]"
                :class="hasProviderConfigured ? 'bg-[var(--color-text-primary)] text-[var(--color-bg-base)] hover:opacity-90' : 'bg-[var(--color-bg-elevated)] text-[var(--color-text-tertiary)] border border-[var(--color-border-mid)] cursor-not-allowed opacity-60'"
                :disabled="!hasProviderConfigured"
                @click="goToStepTwo"
              >
                Next
              </button>
            </div>
          </div>
        </Transition>

        <Transition name="providers-fade">
          <div v-if="step === 2" class="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-6 pb-6 pt-4">
            <h2 class="text-center text-[17px] font-semibold tracking-tight text-[var(--color-text-primary)]">
              Configure STT Provider
            </h2>
            <div class="flex min-w-0 flex-col gap-3">
              <VoiceProviders />
            </div>
            <div class="mt-2 flex gap-3">
              <button
                class="inline-flex h-9 flex-1 items-center justify-center rounded-[var(--radius-md)] border border-[var(--color-border-mid)] bg-transparent px-6 text-[13px] font-medium text-[var(--color-text-secondary)] transition-[opacity,transform,background] duration-150 hover:bg-[var(--color-bg-elevated)] hover:text-[var(--color-text-primary)] active:scale-[0.98]"
                @click="onboarding.hide()"
              >
                Skip
              </button>
              <button
                class="inline-flex h-9 flex-1 items-center justify-center rounded-[var(--radius-md)] px-6 text-[13px] font-medium transition-[opacity,transform,background] duration-150 active:scale-[0.98]"
                :class="hasSttConfigured ? 'bg-[var(--color-text-primary)] text-[var(--color-bg-base)] hover:opacity-90' : 'bg-[var(--color-bg-elevated)] text-[var(--color-text-tertiary)] border border-[var(--color-border-mid)] cursor-not-allowed opacity-60'"
                :disabled="!hasSttConfigured"
                @click="goToStepThree"
              >
                Next
              </button>
            </div>
          </div>
        </Transition>

        <Transition name="providers-fade">
          <div v-if="step === 3" class="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-6 pb-6 pt-4">
            <div class="flex flex-col gap-1 text-center">
              <h2 class="text-[17px] font-semibold tracking-tight text-[var(--color-text-primary)]">
                Choose your look
              </h2>
            </div>

            <div class="grid grid-cols-3 gap-2 sm:grid-cols-5">
              <button
                v-for="t in themeList"
                :key="t.id"
                class="group flex flex-col items-center gap-2 rounded-[var(--radius-md)] border p-3 transition-colors"
                :class="themeStore.activeTheme === t.id ? 'border-[var(--color-accent)] bg-[var(--color-accent-muted)]' : 'border-[var(--color-border-subtle)] bg-[var(--color-bg-card)] hover:border-[var(--color-border-mid)]'"
                @click="themeStore.setTheme(t.id)"
              >
                <div class="h-10 w-full rounded-[var(--radius-sm)] border border-[var(--color-border-subtle)] p-1.5" :style="{ background: t.bg }">
                  <div class="h-1.5 w-1/2 rounded-full" :style="{ background: t.accent }" />
                </div>
                <span class="text-[11px] font-medium leading-none" :class="themeStore.activeTheme === t.id ? 'text-[var(--color-accent-text)]' : 'text-[var(--color-text-secondary)]'">{{ t.name }}</span>
              </button>
            </div>

            <div class="flex flex-col gap-3 rounded-[var(--radius-md)] border border-[var(--color-border-subtle)] bg-[var(--color-bg-card)] p-3">
              <span class="text-[12px] font-semibold text-[var(--color-text-secondary)]">Border Radius</span>
              <label v-for="(_, key) in DEFAULT_RADIUS" :key="key" class="flex items-center gap-3">
                <span class="w-10 text-[11px] font-medium uppercase tracking-wide text-[var(--color-text-tertiary)]">{{ key.replace('--radius-', '') }}</span>
                <input
                  type="range"
                  :min="0"
                  :max="key === '--radius-lg' ? 20 : 12"
                  :value="currentRadius(key)"
                  class="h-1 flex-1 appearance-none rounded-full bg-[var(--color-border-mid)] accent-[var(--color-accent)]"
                  @input="onRadiusInput(key, $event)"
                >
                <span class="w-8 text-right text-[11px] font-mono text-[var(--color-text-tertiary)]">{{ currentRadius(key) }}px</span>
              </label>
              <button
                class="self-start text-[11px] font-medium text-[var(--color-text-tertiary)] hover:text-[var(--color-text-primary)] hover:underline"
                @click="themeStore.resetOverrides()"
              >
                Reset to default
              </button>
            </div>

            <div class="mt-2 flex gap-3">
              <button
                class="inline-flex h-9 flex-1 items-center justify-center rounded-[var(--radius-md)] border border-[var(--color-border-mid)] bg-transparent px-6 text-[13px] font-medium text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-elevated)] hover:text-[var(--color-text-primary)]"
                @click="onboarding.hide()"
              >
                Skip
              </button>
              <button
                class="inline-flex h-9 flex-1 items-center justify-center rounded-[var(--radius-md)] bg-[var(--color-text-primary)] px-6 text-[13px] font-medium text-[var(--color-bg-base)] hover:opacity-90"
                @click="goToStepFour"
              >
                Next
              </button>
            </div>
          </div>
        </Transition>

        <Transition name="providers-fade">
          <div v-if="step === 4" class="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-6 pb-6 pt-4">
            <h2 class="text-center text-[17px] font-semibold tracking-tight text-[var(--color-text-primary)]">
              Other Settings
            </h2>
            <div class="flex flex-col gap-4">
              <div class="settings-card">
                <div class="settings-card-header">
                  <h3 class="settings-card-title">
                    Core Settings
                  </h3>
                </div>
                <div class="settings-list">
                  <label class="settings-item">
                    <div class="settings-item-content">
                      <span class="settings-item-label">Auto project context</span>
                      <span class="settings-item-desc">Load AGENTS.md and DESIGN.md from project root automatically</span>
                    </div>
                    <button class="model-toggle" :class="{ 'model-toggle--on': settings.autoContext.enabled }" type="button" @click="settings.autoContext.enabled = !settings.autoContext.enabled"><span class="model-toggle-thumb" /></button>
                  </label>
                  <label class="settings-item">
                    <div class="settings-item-content">
                      <span class="settings-item-label">Context caching</span>
                      <span class="settings-item-desc">Cache reusable prompt segments to reduce latency and cost</span>
                    </div>
                    <button class="model-toggle" :class="{ 'model-toggle--on': settings.contextCaching.enabled }" type="button" @click="settings.contextCaching.enabled = !settings.contextCaching.enabled"><span class="model-toggle-thumb" /></button>
                  </label>
                  <label class="settings-item">
                    <div class="settings-item-content">
                      <span class="settings-item-label">Agent memory</span>
                      <span class="settings-item-desc">Reuse global preferences and project history across future chats</span>
                    </div>
                    <button class="model-toggle" :class="{ 'model-toggle--on': settings.memory.enabled }" type="button" @click="settings.memory.enabled = !settings.memory.enabled"><span class="model-toggle-thumb" /></button>
                  </label>
                </div>
              </div>

              <div class="settings-card">
                <div class="settings-card-header">
                  <h3 class="settings-card-title">
                    Model Assignment
                  </h3>
                </div>
                <div class="settings-list">
                  <div class="settings-item settings-item--field">
                    <div class="settings-item-content">
                      <span class="settings-item-label">Default model</span>
                      <span class="settings-item-desc">Model used for new conversations</span>
                    </div>
                    <select v-model="settings.agent.defaultModelUid" class="settings-select">
                      <option :value="null">
                        Global default
                      </option>
                      <option v-for="m in settings.enabledModels" :key="m.uid" :value="m.uid">
                        {{ m.name }}
                      </option>
                    </select>
                  </div>
                  <div class="settings-item settings-item--field">
                    <div class="settings-item-content">
                      <span class="settings-item-label">Sub-agent model</span>
                      <span class="settings-item-desc">Defaults to the parent's model</span>
                    </div>
                    <select v-model="settings.agent.subagentModelUid" class="settings-select">
                      <option :value="null">
                        Same as parent
                      </option>
                      <option v-for="m in settings.enabledModels" :key="m.uid" :value="m.uid">
                        {{ m.name }}
                      </option>
                    </select>
                  </div>
                </div>
              </div>

              <div class="settings-card">
                <div class="settings-card-header">
                  <h3 class="settings-card-title">
                    Permissions
                  </h3>
                </div>
                <div class="settings-list">
                  <div class="settings-item settings-item--field">
                    <div class="settings-item-content">
                      <span class="settings-item-label">Permission Mode</span>
                      <span class="settings-item-desc">Ask prompts every call. Auto approves safe actions. Yolo allows everything.</span>
                    </div>
                    <select v-model="settings.agent.permissionMode" class="settings-select">
                      <option value="ask">
                        Ask
                      </option>
                      <option value="auto">
                        Auto
                      </option>
                      <option value="yolo">
                        Yolo
                      </option>
                    </select>
                  </div>
                </div>
              </div>

              <div class="settings-card">
                <div class="settings-card-header">
                  <h3 class="settings-card-title">
                    Git Co-Authoring
                  </h3>
                </div>
                <div class="settings-list">
                  <label class="settings-item">
                    <div class="settings-item-content">
                      <span class="settings-item-label">Attribution</span>
                      <span class="settings-item-desc">Adds a Co-authored-by trailer to agent commits</span>
                    </div>
                    <button class="model-toggle" :class="{ 'model-toggle--on': settings.agent.gitCoAuthor }" type="button" @click="settings.agent.gitCoAuthor = !settings.agent.gitCoAuthor"><span class="model-toggle-thumb" /></button>
                  </label>
                </div>
              </div>

              <div class="settings-card">
                <div class="settings-card-header">
                  <h3 class="settings-card-title">
                    Session Compaction
                  </h3>
                </div>
                <div class="settings-list">
                  <label class="settings-item">
                    <div class="settings-item-content">
                      <span class="settings-item-label">Auto compact</span>
                      <span class="settings-item-desc">Summarize older turns automatically past the threshold</span>
                    </div>
                    <button class="model-toggle" :class="{ 'model-toggle--on': settings.agent.sessionCompaction.auto }" type="button" @click="settings.agent.sessionCompaction.auto = !settings.agent.sessionCompaction.auto"><span class="model-toggle-thumb" /></button>
                  </label>
                  <div class="settings-item settings-item--field">
                    <div class="settings-item-content">
                      <span class="settings-item-label">Threshold</span>
                      <span class="settings-item-desc">Recommended 80-85% before hard-fail</span>
                      <div class="mt-1.5 flex items-center gap-2">
                        <input v-model.number="settings.agent.sessionCompaction.thresholdPercent" type="range" min="80" max="85" step="1" class="h-1 flex-1 accent-[var(--color-accent)]">
                        <span class="w-8 text-right text-[11px] font-semibold text-[var(--color-text-secondary)]">{{ settings.agent.sessionCompaction.thresholdPercent }}%</span>
                      </div>
                    </div>
                  </div>
                  <label class="settings-item">
                    <div class="settings-item-content">
                      <span class="settings-item-label">Manual compact button</span>
                      <span class="settings-item-desc">Show the compact button in the estimator popover</span>
                    </div>
                    <button class="model-toggle" :class="{ 'model-toggle--on': settings.agent.sessionCompaction.showManualButton }" type="button" @click="settings.agent.sessionCompaction.showManualButton = !settings.agent.sessionCompaction.showManualButton"><span class="model-toggle-thumb" /></button>
                  </label>
                </div>
              </div>
            </div>
            <div class="mt-2 flex gap-3">
              <button class="inline-flex h-9 flex-1 items-center justify-center rounded-[var(--radius-md)] border border-[var(--color-border-mid)] bg-transparent px-6 text-[13px] font-medium text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-elevated)] hover:text-[var(--color-text-primary)]" @click="onboarding.hide()">
                Skip
              </button>
              <button class="inline-flex h-9 flex-1 items-center justify-center rounded-[var(--radius-md)] bg-[var(--color-text-primary)] px-6 text-[13px] font-medium text-[var(--color-bg-base)] hover:opacity-90" @click="finishOnboarding">
                Finish
              </button>
            </div>
          </div>
        </Transition>
      </div>
      <ProviderBrowser v-model="showProviderBrowser" />
    </div>
  </div>
</template>

<style scoped>
.welcome-content-fade-enter-active {
  transition:
    opacity 280ms ease,
    transform 280ms cubic-bezier(0.16, 1, 0.3, 1);
  will-change: transform, opacity;
  backface-visibility: hidden;
}
.welcome-content-fade-leave-active {
  transition: opacity 200ms ease;
}
.welcome-content-fade-enter-from {
  opacity: 0;
  transform: translateY(8px) translateZ(0);
}
.welcome-content-fade-leave-to {
  opacity: 0;
}

.big-one-fade-enter-active {
  transition: opacity 200ms ease;
}
.big-one-fade-leave-active {
  transition: opacity 200ms ease;
}
.big-one-fade-enter-from,
.big-one-fade-leave-to {
  opacity: 0;
}

.indicator-fade-enter-active {
  transition:
    opacity 320ms ease,
    transform 320ms cubic-bezier(0.16, 1, 0.3, 1);
  will-change: transform, opacity;
}
.indicator-fade-enter-from {
  opacity: 0;
  transform: translateY(4px);
}
.indicator-fade-leave-to {
  opacity: 0;
}

.providers-fade-enter-active {
  transition:
    opacity 300ms ease 100ms,
    transform 300ms cubic-bezier(0.16, 1, 0.3, 1) 100ms;
  will-change: transform, opacity;
}
.providers-fade-enter-from {
  opacity: 0;
  transform: translateY(8px);
}
.providers-fade-leave-to {
  opacity: 0;
}

.step-one-stage {
  position: relative;
  width: 100%;
  height: 100%;
  min-height: 200px;
  display: flex;
  flex-direction: column;
}

.one-char {
  position: absolute;
  left: 50%;
  top: 50%;
  font-size: 96px;
  font-weight: 300;
  line-height: 1;
  color: var(--color-text-primary);
  transform: translate(-50%, -50%) scale(1) translateZ(0);
  transform-origin: center;
  will-change: transform, font-size, top, left;
  backface-visibility: hidden;
  -webkit-font-smoothing: antialiased;
  animation: oneMove 1250ms forwards;
}

@keyframes oneMove {
  0% {
    left: 50%;
    top: 50%;
    font-size: 96px;
    transform: translate(-50%, -50%) scale(1) translateZ(0);
    animation-timing-function: linear;
  }
  40% {
    left: 50%;
    top: 50%;
    font-size: 96px;
    transform: translate(-50%, -50%) scale(1) translateZ(0);
    animation-timing-function: cubic-bezier(0.16, 1, 0.3, 1);
  }
  100% {
    left: 38px;
    top: 38px;
    font-size: 13px;
    transform: translate(-50%, -50%) scale(1) translateZ(0);
  }
}

.add-provider-card {
  display: flex;
  align-items: center;
  gap: 14px;
  width: 100%;
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
  min-width: 0;
  overflow: hidden;
}
.add-provider-title {
  font-size: 13.5px;
  font-weight: 600;
  color: var(--color-text-primary);
}
.add-provider-desc {
  font-size: 12px;
  color: var(--color-text-tertiary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.model-toggle {
  position: relative;
  display: flex;
  align-items: center;
  width: 34px;
  height: 20px;
  border-radius: var(--radius-pill);
  border: 1px solid var(--color-border-mid);
  background: var(--color-toggle-track-off);
  cursor: pointer;
  transition:
    background 140ms ease,
    border-color 140ms ease;
  flex-shrink: 0;
}
.model-toggle--on {
  background: var(--color-toggle-track-on);
  border-color: var(--color-accent);
}
.model-toggle-thumb {
  position: absolute;
  left: 2px;
  width: 14px;
  height: 14px;
  border-radius: 50%;
  background: var(--color-toggle-thumb-off);
  transition:
    transform 140ms cubic-bezier(0.4, 0, 0.2, 1),
    background 140ms ease;
}
.model-toggle--on .model-toggle-thumb {
  transform: translateX(14px);
  background: var(--color-text-primary);
}

.settings-card {
  background: var(--color-bg-surface);
  border: 1px solid var(--color-border-subtle);
  border-radius: var(--radius-lg);
  overflow: hidden;
}
.settings-card-header {
  padding: 12px 14px 8px;
  border-bottom: 1px solid var(--color-border-subtle);
}
.settings-card-title {
  margin: 0;
  font-size: 12px;
  font-weight: 600;
  color: var(--color-text-secondary);
  letter-spacing: 0.01em;
}
.settings-list {
  display: flex;
  flex-direction: column;
}
.settings-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 10px 14px;
  border-bottom: 1px solid var(--color-border-subtle);
}
.settings-item:last-child {
  border-bottom: none;
}
.settings-item--field {
  cursor: default;
}
.settings-item-content {
  display: flex;
  flex-direction: column;
  gap: 2px;
  flex: 1;
  min-width: 0;
}
.settings-item-label {
  font-size: 12.5px;
  font-weight: 500;
  color: var(--color-text-primary);
  line-height: 1.3;
}
.settings-item-desc {
  font-size: 11px;
  color: var(--color-text-tertiary);
  line-height: 1.35;
}
.settings-select {
  height: 30px;
  max-width: 110px;
  padding-inline: 8px;
  background: var(--color-bg-elevated);
  border: 1px solid var(--color-border-mid);
  border-radius: var(--radius-md);
  color: var(--color-text-primary);
  font-size: 11.5px;
  font-family: inherit;
  outline: none;
  cursor: pointer;
  flex-shrink: 0;
}
.settings-select:focus {
  border-color: var(--color-accent-dim);
}
</style>
