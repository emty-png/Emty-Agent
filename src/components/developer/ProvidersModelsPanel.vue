<script setup lang="ts">
import type { ModelSamplingOverride } from '@/stores/settings/types'
import { Activity, Brain, EyeOff, FileStack, FileText, Globe, Hash, Puzzle, SlidersHorizontal, Sparkles, Thermometer, Zap } from 'lucide-vue-next'
import { storeToRefs } from 'pinia'
import { computed, ref } from 'vue'
import { useSettingsStore } from '@/stores/settings'
import { ALL_PROVIDERS, getProviderIconUrl } from '@/utils/modelsdev'

const props = withDefaults(defineProps<{
  selectedProviderId?: string | null
}>(), {
  selectedProviderId: 'global',
})

const settings = useSettingsStore()
const { openai, anthropic, google, compatibleProviders, providerAppearance, providerSampling, modelSampling, providerContext, providerReasoning, discoveredModels } = storeToRefs(settings)

const isGlobal = computed(() => !props.selectedProviderId || props.selectedProviderId === 'global')

interface ProviderEntry {
  id: string
  name: string
  subtitle: string
  mdevId?: string
}

const builtinConfigured = computed<ProviderEntry[]>(() => {
  const list: ProviderEntry[] = []
  if (openai.value.apiKey.trim())
    list.push({ id: 'openai', name: 'OpenAI', subtitle: 'api.openai.com', mdevId: 'openai' })
  if (anthropic.value.apiKey.trim())
    list.push({ id: 'anthropic', name: 'Anthropic', subtitle: 'api.anthropic.com', mdevId: 'anthropic' })
  if (google.value.apiKey.trim())
    list.push({ id: 'google', name: 'Google Gemini', subtitle: 'generativelanguage.googleapis.com', mdevId: 'google' })
  return list
})

const compatibleConfigured = computed<ProviderEntry[]>(() => {
  return compatibleProviders.value
    .filter(p => p.baseURL.trim() || p.apiKey.trim() || (p.headers && Object.keys(p.headers).length > 0))
    .filter(p => p.apiKey.trim() || p.baseURL.trim())
    .map(p => {
      const entry: ProviderEntry = {
        id: p.id,
        name: p.name || 'Unnamed Provider',
        subtitle: p.baseURL || p.mdevId || p.id,
      }
      if (p.mdevId)
        entry.mdevId = p.mdevId
      return entry
    })
})

const configuredProviders = computed<ProviderEntry[]>(() => [
  ...builtinConfigured.value,
  ...compatibleConfigured.value,
])

const selectedProvider = computed<ProviderEntry | null>(() => {
  if (isGlobal.value)
    return null
  return configuredProviders.value.find(p => p.id === props.selectedProviderId) ?? null
})

const failedIcons = ref<Set<string>>(new Set())

function onIconError(id: string) {
  failedIcons.value = new Set([...failedIcons.value, id])
}

function providerIconUrl(entry: ProviderEntry): string | null {
  if (!entry.mdevId)
    return null
  const known = ALL_PROVIDERS.find(p => p.id === entry.mdevId)
  if (!known && entry.mdevId)
    return getProviderIconUrl(entry.mdevId)
  return entry.mdevId ? getProviderIconUrl(entry.mdevId) : null
}

// ── helpers for toggles ────────────────────────────────────────────────────────
function globalValue(key: keyof typeof providerAppearance.value.global): boolean {
  return providerAppearance.value.global[key]
}
function perProviderValue(providerId: string, key: 'hideThinking' | 'disableThinkingMarkdown' | 'disableAssistantMarkdown'): boolean {
  return !!providerAppearance.value.perProvider[providerId]?.[key]
}
function effectiveValue(providerId: string, key: 'hideThinking' | 'disableThinkingMarkdown' | 'disableAssistantMarkdown'): boolean {
  if (providerAppearance.value.global[key])
    return true
  return !!providerAppearance.value.perProvider[providerId]?.[key]
}

function setGlobal(key: keyof typeof providerAppearance.value.global, val: boolean) {
  settings.setGlobalAppearance(key, val)
}
function setPerProvider(providerId: string, key: 'hideThinking' | 'disableThinkingMarkdown' | 'disableAssistantMarkdown', val: boolean) {
  settings.setProviderAppearance(providerId, key, val)
}

const KNOWN_PRESET_IDS = new Set(ALL_PROVIDERS.map(p => p.id))
function isCustomCompatible(entry: ProviderEntry): boolean {
  if (['openai', 'anthropic', 'google'].includes(entry.id))
    return false
  return !entry.mdevId || !KNOWN_PRESET_IDS.has(entry.mdevId)
}

// ── sampling helpers ─────────────────────────────────────────────────────────
type SamplingKey = 'temperature' | 'topP' | 'topK' | 'maxTokens' | 'frequencyPenalty' | 'presencePenalty' | 'seed'

interface SamplingParamMeta {
  key: SamplingKey
  label: string
  desc: string
  min: number
  max: number
  step: number
  default: number
  icon: typeof Thermometer
}

const SAMPLING_PARAMS: SamplingParamMeta[] = [
  {
    key: 'temperature',
    label: 'Temperature',
    desc: 'Controls randomness. Lower = more deterministic, higher = more creative (0–2).',
    min: 0,
    max: 2,
    step: 0.05,
    default: 1,
    icon: Thermometer,
  },
  {
    key: 'topP',
    label: 'Top P',
    desc: 'Nucleus sampling. Limits to tokens with cumulative probability ≤ p (0–1).',
    min: 0,
    max: 1,
    step: 0.05,
    default: 1,
    icon: SlidersHorizontal,
  },
  {
    key: 'topK',
    label: 'Top K',
    desc: 'Limits to top K tokens. 0 = disabled (0–100).',
    min: 0,
    max: 100,
    step: 1,
    default: 0,
    icon: Hash,
  },
  {
    key: 'maxTokens',
    label: 'Max Output Tokens',
    desc: 'Maximum tokens to generate per turn (256–32768). Overrides model default when set.',
    min: 256,
    max: 32768,
    step: 256,
    default: 4096,
    icon: FileStack,
  },
  {
    key: 'frequencyPenalty',
    label: 'Frequency Penalty',
    desc: 'Penalizes repeated tokens. Positive reduces repetition (−2 to 2).',
    min: -2,
    max: 2,
    step: 0.1,
    default: 0,
    icon: Activity,
  },
  {
    key: 'presencePenalty',
    label: 'Presence Penalty',
    desc: 'Penalizes tokens that have already appeared. Encourages new topics (−2 to 2).',
    min: -2,
    max: 2,
    step: 0.1,
    default: 0,
    icon: Zap,
  },
  {
    key: 'seed',
    label: 'Seed',
    desc: 'Deterministic sampling seed for reproducible outputs (0–2147483647).',
    min: 0,
    max: 2147483647,
    step: 1,
    default: 42,
    icon: Hash,
  },
]

function globalSamplingValue(key: SamplingKey): number | undefined {
  return providerSampling.value.global[key]
}
function perSamplingValue(providerId: string, key: SamplingKey): number | undefined {
  return providerSampling.value.perProvider[providerId]?.[key]
}
function effectiveSamplingValue(providerId: string, key: SamplingKey): number | undefined {
  const per = perSamplingValue(providerId, key)
  if (per !== undefined)
    return per
  return globalSamplingValue(key)
}
function isGlobalSamplingEnabled(key: SamplingKey): boolean {
  return globalSamplingValue(key) !== undefined
}
function isPerSamplingEnabled(providerId: string, key: SamplingKey): boolean {
  return perSamplingValue(providerId, key) !== undefined
}
function toggleGlobalSampling(key: SamplingKey): void {
  const cur = globalSamplingValue(key)
  if (cur !== undefined) {
    settings.setGlobalSampling(key, undefined)
  }
  else {
    const meta = SAMPLING_PARAMS.find(p => p.key === key)
    settings.setGlobalSampling(key, meta?.default ?? 0)
  }
}
function togglePerSampling(providerId: string, key: SamplingKey): void {
  const cur = perSamplingValue(providerId, key)
  if (cur !== undefined) {
    settings.setProviderSampling(providerId, key, undefined)
  }
  else {
    const meta = SAMPLING_PARAMS.find(p => p.key === key)
    settings.setProviderSampling(providerId, key, meta?.default ?? 0)
  }
}
function onGlobalSliderInput(key: SamplingKey, event: Event): void {
  const target = event.target as HTMLInputElement
  const val = target.value === '' ? undefined : Number(target.value)
  if (val !== undefined && !Number.isNaN(val))
    settings.setGlobalSampling(key, val)
}
function onPerSliderInput(providerId: string, key: SamplingKey, event: Event): void {
  const target = event.target as HTMLInputElement
  const val = target.value === '' ? undefined : Number(target.value)
  if (val !== undefined && !Number.isNaN(val))
    settings.setProviderSampling(providerId, key, val)
}
function formatSamplingValue(key: SamplingKey, value: number | undefined): string {
  if (value === undefined)
    return 'Default'
  if (key === 'maxTokens' || key === 'topK' || key === 'seed')
    return String(Math.round(value))
  return value.toFixed(key === 'temperature' || key === 'topP' ? 2 : 1)
}

// ── advanced generation (stop, responseFormat, parallel) ─────────────────────
function globalStopSequences(): string[] | undefined {
  return providerSampling.value.global.stopSequences
}
function perStopSequences(providerId: string): string[] | undefined {
  return providerSampling.value.perProvider[providerId]?.stopSequences
}
function effectiveStopSequences(providerId: string): string[] | undefined {
  const per = perStopSequences(providerId)
  if (per !== undefined)
    return per
  return globalStopSequences()
}
function isGlobalStopEnabled(): boolean {
  return globalStopSequences() !== undefined
}
function isPerStopEnabled(providerId: string): boolean {
  return perStopSequences(providerId) !== undefined
}
function toggleGlobalStop(): void {
  if (isGlobalStopEnabled())
    settings.setGlobalSampling('stopSequences', undefined)
  else settings.setGlobalSampling('stopSequences', [])
}
function togglePerStop(providerId: string): void {
  if (isPerStopEnabled(providerId))
    settings.setProviderSampling(providerId, 'stopSequences', undefined)
  else settings.setProviderSampling(providerId, 'stopSequences', [])
}
function onGlobalStopInput(event: Event): void {
  const v = (event.target as HTMLTextAreaElement).value
  const arr = v.split(/[,\n]/).map(s => s.trim()).filter(Boolean).slice(0, 10)
  settings.setGlobalSampling('stopSequences', arr.length > 0 ? arr : [])
}
function onPerStopInput(providerId: string, event: Event): void {
  const v = (event.target as HTMLTextAreaElement).value
  const arr = v.split(/[,\n]/).map(s => s.trim()).filter(Boolean).slice(0, 10)
  settings.setProviderSampling(providerId, 'stopSequences', arr.length > 0 ? arr : [])
}

function globalResponseFormat(): string | undefined {
  return providerSampling.value.global.responseFormat
}
function perResponseFormat(providerId: string): string | undefined {
  return providerSampling.value.perProvider[providerId]?.responseFormat
}
function isGlobalResponseFormatEnabled(): boolean {
  return globalResponseFormat() !== undefined
}
function isPerResponseFormatEnabled(providerId: string): boolean {
  return perResponseFormat(providerId) !== undefined
}
function toggleGlobalResponseFormat(): void {
  if (isGlobalResponseFormatEnabled())
    settings.setGlobalSampling('responseFormat', undefined)
  else settings.setGlobalSampling('responseFormat', 'json_object')
}
function togglePerResponseFormat(providerId: string): void {
  if (isPerResponseFormatEnabled(providerId))
    settings.setProviderSampling(providerId, 'responseFormat', undefined)
  else settings.setProviderSampling(providerId, 'responseFormat', 'json_object')
}
function onGlobalResponseFormatChange(event: Event): void {
  const v = (event.target as HTMLSelectElement).value as 'text' | 'json_object' | 'json_schema'
  settings.setGlobalSampling('responseFormat', v)
}
function onPerResponseFormatChange(providerId: string, event: Event): void {
  const v = (event.target as HTMLSelectElement).value as 'text' | 'json_object' | 'json_schema'
  settings.setProviderSampling(providerId, 'responseFormat', v)
}

function globalParallelToolCalls(): boolean | undefined {
  return providerSampling.value.global.parallelToolCalls
}
function perParallelToolCalls(providerId: string): boolean | undefined {
  return providerSampling.value.perProvider[providerId]?.parallelToolCalls
}
function effectiveParallelToolCalls(providerId: string): boolean | undefined {
  const per = perParallelToolCalls(providerId)
  if (per !== undefined)
    return per
  return globalParallelToolCalls()
}
function onGlobalParallelToolCallsChange(event: Event): void {
  const v = (event.target as HTMLSelectElement).value
  settings.setGlobalSampling('parallelToolCalls', v === 'default' ? undefined : v === 'true')
}
function onPerParallelToolCallsChange(providerId: string, event: Event): void {
  const v = (event.target as HTMLSelectElement).value
  settings.setProviderSampling(providerId, 'parallelToolCalls', v === 'default' ? undefined : v === 'true')
}
// Note: toggleGlobalParallelToolCalls / togglePerParallelToolCalls functions are obsolete in UI logic
// due to replacing ambiguous toggles with direct select bindings, but kept internally intact.

// ── context & reasoning ──────────────────────────────────────────────────────
function globalContextLimit(): number | undefined {
  return providerContext.value.global.contextLimit
}
function perContextLimit(providerId: string): number | undefined {
  return providerContext.value.perProvider[providerId]?.contextLimit
}
function effectiveContextLimit(providerId: string): number | undefined {
  const per = perContextLimit(providerId)
  if (per !== undefined)
    return per
  return globalContextLimit()
}
function globalReasoningBudget(): number | undefined {
  return providerReasoning.value.global.customBudgetTokens
}
function perReasoningBudget(providerId: string): number | undefined {
  return providerReasoning.value.perProvider[providerId]?.customBudgetTokens
}
function effectiveReasoningBudget(providerId: string): number | undefined {
  return perReasoningBudget(providerId) ?? globalReasoningBudget()
}

// ── per-model overrides ──────────────────────────────────────────────────────
const modelsForSelectedProvider = computed(() => {
  if (!selectedProvider.value)
    return []
  return discoveredModels.value.filter(m => m.providerId === selectedProvider.value!.id)
})
const expandedModels = ref<Set<string>>(new Set())
function toggleModelExpand(uid: string): void {
  const next = new Set(expandedModels.value)
  if (next.has(uid))
    next.delete(uid)
  else next.add(uid)
  expandedModels.value = next
}
function isModelExpanded(uid: string): boolean {
  return expandedModels.value.has(uid)
}
function modelSamplingValue(uid: string, key: keyof ModelSamplingOverride): number | string | string[] | undefined {
  return (modelSampling.value[uid] as Record<string, unknown>)?.[key as string] as unknown as number | string | string[] | undefined
}
function isModelSamplingEnabled(uid: string, key: keyof ModelSamplingOverride): boolean {
  return modelSamplingValue(uid, key) !== undefined
}
function toggleModelSampling(uid: string, key: keyof ModelSamplingOverride): void {
  const cur = modelSamplingValue(uid, key)
  if (cur !== undefined) {
    settings.setModelSampling(uid, key, undefined)
  }
  else {
    const defaults: Record<string, number> = { temperature: 1, topP: 1, topK: 0, maxTokens: 4096, frequencyPenalty: 0, presencePenalty: 0, seed: 42, contextLimit: 128000 }
    const def = defaults[key as string] ?? 0
    settings.setModelSampling(uid, key, def)
  }
}
function onModelSliderInput(uid: string, key: keyof ModelSamplingOverride, event: Event): void {
  const v = Number((event.target as HTMLInputElement).value)
  if (!Number.isNaN(v))
    settings.setModelSampling(uid, key, v)
}
</script>

<template>
  <div class="flex flex-1 min-h-0 min-w-0 overflow-hidden bg-[var(--color-bg-base)]">
    <div class="flex flex-1 min-w-0 min-h-0 flex-col overflow-hidden bg-[var(--color-bg-base)]">
      <!-- Global view -->
      <template v-if="isGlobal">
        <div class="flex items-center gap-4 px-6 py-4 border-b border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)] shrink-0 shadow-sm">
          <div class="grid place-items-center w-10 h-10 rounded-[var(--radius-md)] bg-white border border-zinc-200 shrink-0 shadow-sm">
            <Globe :size="20" :stroke-width="1.8" class="text-zinc-700" />
          </div>
          <div class="flex flex-col gap-0.5 min-w-0">
            <h2 class="m-0 text-[15px] font-semibold text-[var(--color-text-primary)] leading-[1.2]">
              Global Settings
            </h2>
            <span class="text-[12.5px] text-[var(--color-text-tertiary)] leading-[1.3] truncate">Defaults applied to all providers unless overridden</span>
          </div>
        </div>

        <div class="flex-1 min-h-0 overflow-y-auto px-6 py-5 pb-8 flex flex-col gap-5">
          <div class="flex items-start gap-3 p-3 px-4 rounded-[var(--radius-lg)] bg-[var(--color-accent-muted)] border border-[var(--color-accent-dim)] text-[var(--color-text-secondary)] text-[12.5px] leading-[1.5] shrink-0 mb-1">
            <Sparkles :size="16" :stroke-width="1.8" class="shrink-0 text-[var(--color-accent-text)] mt-[1px]" />
            <span class="flex-1">Global appearance and generation defaults. Provider-specific overrides inherit from here when not set. Effective value is always: <strong class="text-[var(--color-accent-text)]">provider override → global → provider default</strong>.</span>
          </div>

          <!-- Appearance - Global -->
          <section class="bg-[var(--color-bg-surface)] border border-[var(--color-border-subtle)] rounded-[var(--radius-lg)] overflow-hidden shrink-0 flex flex-col divide-y divide-[var(--color-border-subtle)]">
            <div class="flex items-start gap-4 p-4 px-5">
              <div class="grid place-items-center w-8 h-8 rounded-[var(--radius-md)] bg-[var(--color-bg-elevated)] text-[var(--color-text-secondary)] shrink-0 border border-[var(--color-border-subtle)] mt-0.5">
                <EyeOff :size="16" :stroke-width="1.8" />
              </div>
              <div class="flex-1 flex flex-col min-w-0">
                <h3 class="m-0 text-[13.5px] font-semibold text-[var(--color-text-primary)] leading-[1.3]">
                  Hide thinking blocks
                </h3>
                <p class="m-0 text-[12px] text-[var(--color-text-tertiary)] leading-[1.4] mt-[3px]">
                  Hide the collapsible thinking/reasoning blocks in assistant messages across all models.
                </p>
              </div>
              <button type="button" role="switch" :aria-checked="globalValue('hideThinking')" class="ui-toggle mt-1" @click="setGlobal('hideThinking', !globalValue('hideThinking'))">
                <span class="ui-toggle-thumb" />
              </button>
            </div>

            <div class="flex items-start gap-4 p-4 px-5">
              <div class="grid place-items-center w-8 h-8 rounded-[var(--radius-md)] bg-[var(--color-bg-elevated)] text-[var(--color-text-secondary)] shrink-0 border border-[var(--color-border-subtle)] mt-0.5">
                <Brain :size="16" :stroke-width="1.8" />
              </div>
              <div class="flex-1 flex flex-col min-w-0">
                <h3 class="m-0 text-[13.5px] font-semibold text-[var(--color-text-primary)] leading-[1.3]">
                  Turn off thinking markdown
                </h3>
                <p class="m-0 text-[12px] text-[var(--color-text-tertiary)] leading-[1.4] mt-[3px]">
                  Render thinking/reasoning as plain pre-wrapped text instead of formatted markdown.
                </p>
              </div>
              <button type="button" role="switch" :aria-checked="globalValue('disableThinkingMarkdown')" class="ui-toggle mt-1" @click="setGlobal('disableThinkingMarkdown', !globalValue('disableThinkingMarkdown'))">
                <span class="ui-toggle-thumb" />
              </button>
            </div>

            <div class="flex items-start gap-4 p-4 px-5">
              <div class="grid place-items-center w-8 h-8 rounded-[var(--radius-md)] bg-[var(--color-bg-elevated)] text-[var(--color-text-secondary)] shrink-0 border border-[var(--color-border-subtle)] mt-0.5">
                <FileText :size="16" :stroke-width="1.8" />
              </div>
              <div class="flex-1 flex flex-col min-w-0">
                <h3 class="m-0 text-[13.5px] font-semibold text-[var(--color-text-primary)] leading-[1.3]">
                  Turn off assistant message markdown
                </h3>
                <p class="m-0 text-[12px] text-[var(--color-text-tertiary)] leading-[1.4] mt-[3px]">
                  Render regular assistant messages as plain text globally.
                </p>
              </div>
              <button type="button" role="switch" :aria-checked="globalValue('disableAssistantMarkdown')" class="ui-toggle mt-1" @click="setGlobal('disableAssistantMarkdown', !globalValue('disableAssistantMarkdown'))">
                <span class="ui-toggle-thumb" />
              </button>
            </div>
          </section>

          <div class="flex items-center gap-3 mt-3 mb-1 shrink-0">
            <div class="flex-1 h-px bg-[var(--color-border-subtle)]" />
            <span class="text-[11px] font-semibold tracking-[0.08em] uppercase text-[var(--color-text-tertiary)] whitespace-nowrap">Generation Sampling — Global</span>
            <div class="flex-1 h-px bg-[var(--color-border-subtle)]" />
          </div>

          <section v-for="param in SAMPLING_PARAMS" :key="param.key" class="bg-[var(--color-bg-surface)] border border-[var(--color-border-subtle)] rounded-[var(--radius-lg)] overflow-hidden shrink-0 flex flex-col transition-colors">
            <div class="flex items-start gap-4 p-4 px-5">
              <div class="grid place-items-center w-8 h-8 rounded-[var(--radius-md)] bg-[var(--color-bg-elevated)] text-[var(--color-text-secondary)] shrink-0 border border-[var(--color-border-subtle)] mt-0.5">
                <component :is="param.icon" :size="16" :stroke-width="1.8" />
              </div>
              <div class="flex-1 flex flex-col min-w-0">
                <div class="flex items-center gap-2">
                  <h3 class="m-0 text-[13.5px] font-semibold text-[var(--color-text-primary)] leading-[1.3]">
                    {{ param.label }}
                  </h3>
                  <span v-if="isGlobalSamplingEnabled(param.key)" class="font-mono text-[10px] font-semibold px-1.5 py-0.5 rounded-[var(--radius-sm)] bg-[var(--color-bg-elevated)] text-[var(--color-text-secondary)] border border-[var(--color-border-subtle)]">{{ formatSamplingValue(param.key, globalSamplingValue(param.key)) }}</span>
                </div>
                <p class="m-0 text-[12px] text-[var(--color-text-tertiary)] leading-[1.4] mt-[3px]">
                  {{ param.desc }}
                </p>

                <div v-if="isGlobalSamplingEnabled(param.key)" class="mt-4 mb-1 flex items-center gap-4">
                  <input
                    type="range"
                    class="pm-slider flex-1 min-w-0 h-1 appearance-none bg-[var(--color-border-mid)] rounded-full outline-none cursor-pointer"
                    :min="param.min"
                    :max="param.max"
                    :step="param.step"
                    :value="globalSamplingValue(param.key)!"
                    @input="onGlobalSliderInput(param.key, $event)"
                  >
                  <input
                    type="number"
                    class="w-[72px] h-7 px-2 rounded-[var(--radius-md)] border border-[var(--color-border-mid)] bg-[var(--color-bg-elevated)] text-[var(--color-text-primary)] font-mono text-[12px] outline-none focus:border-[var(--color-accent-dim)] focus:ring-2 focus:ring-[color-mix(in_srgb,var(--color-accent)_20%,transparent)]"
                    :min="param.min"
                    :max="param.max"
                    :step="param.step"
                    :value="globalSamplingValue(param.key)"
                    @input="onGlobalSliderInput(param.key, $event)"
                  >
                </div>
              </div>
              <button type="button" role="switch" :aria-checked="isGlobalSamplingEnabled(param.key)" class="ui-toggle mt-1" @click="toggleGlobalSampling(param.key)">
                <span class="ui-toggle-thumb" />
              </button>
            </div>
          </section>

          <section class="bg-[var(--color-bg-surface)] border border-[var(--color-border-subtle)] rounded-[var(--radius-lg)] overflow-hidden shrink-0 flex flex-col">
            <div class="flex items-start gap-4 p-4 px-5">
              <div class="grid place-items-center w-8 h-8 rounded-[var(--radius-md)] bg-[var(--color-bg-elevated)] text-[var(--color-text-secondary)] shrink-0 border border-[var(--color-border-subtle)] mt-0.5">
                <FileText :size="16" :stroke-width="1.8" />
              </div>
              <div class="flex-1 flex flex-col min-w-0">
                <div class="flex items-center gap-2">
                  <h3 class="m-0 text-[13.5px] font-semibold text-[var(--color-text-primary)] leading-[1.3]">
                    Stop Sequences
                  </h3>
                  <span v-if="isGlobalStopEnabled()" class="font-mono text-[10px] font-semibold px-1.5 py-0.5 rounded-[var(--radius-sm)] bg-[var(--color-bg-elevated)] text-[var(--color-text-secondary)] border border-[var(--color-border-subtle)]">{{ (globalStopSequences() ?? []).length }} set</span>
                </div>
                <p class="m-0 text-[12px] text-[var(--color-text-tertiary)] leading-[1.4] mt-[3px]">
                  Strings that immediately stop generation. Comma or newline separated, up to 10 values.
                </p>

                <div v-if="isGlobalStopEnabled()" class="mt-3.5 mb-1">
                  <textarea
                    class="w-full min-h-[60px] p-2.5 px-3 rounded-[var(--radius-md)] border border-[var(--color-border-mid)] bg-[var(--color-bg-elevated)] text-[var(--color-text-primary)] font-mono text-[12.5px] leading-[1.5] resize-y outline-none focus:border-[var(--color-accent-dim)] focus:ring-2 focus:ring-[color-mix(in_srgb,var(--color-accent)_20%,transparent)] shadow-sm"
                    rows="2"
                    placeholder="e.g. <STOP>, END, ###"
                    :value="(globalStopSequences() ?? []).join(', ')"
                    @input="onGlobalStopInput($event)"
                  />
                </div>
              </div>
              <button type="button" role="switch" :aria-checked="isGlobalStopEnabled()" class="ui-toggle mt-1" @click="toggleGlobalStop()">
                <span class="ui-toggle-thumb" />
              </button>
            </div>
          </section>

          <section class="bg-[var(--color-bg-surface)] border border-[var(--color-border-subtle)] rounded-[var(--radius-lg)] shrink-0 flex flex-col divide-y divide-[var(--color-border-subtle)]">
            <div class="flex items-start gap-4 p-4 px-5">
              <div class="grid place-items-center w-8 h-8 rounded-[var(--radius-md)] bg-[var(--color-bg-elevated)] text-[var(--color-text-secondary)] shrink-0 border border-[var(--color-border-subtle)] mt-0.5">
                <Sparkles :size="16" :stroke-width="1.8" />
              </div>
              <div class="flex-1 flex flex-col min-w-0">
                <h3 class="m-0 text-[13.5px] font-semibold text-[var(--color-text-primary)] leading-[1.3]">
                  JSON Mode
                </h3>
                <p class="m-0 text-[12px] text-[var(--color-text-tertiary)] leading-[1.4] mt-[3px]">
                  Force structured JSON output format globally.
                </p>
                <div v-if="isGlobalResponseFormatEnabled()" class="mt-3.5 mb-1">
                  <select class="w-[180px] h-8 px-3 rounded-[var(--radius-md)] border border-[var(--color-border-mid)] bg-[var(--color-bg-elevated)] text-[var(--color-text-primary)] text-[12.5px] outline-none focus:border-[var(--color-accent-dim)] shadow-sm" :value="globalResponseFormat()" @change="onGlobalResponseFormatChange($event)">
                    <option value="text">
                      text
                    </option>
                    <option value="json_object">
                      json_object
                    </option>
                    <option value="json_schema">
                      json_schema
                    </option>
                  </select>
                </div>
              </div>
              <button type="button" role="switch" :aria-checked="isGlobalResponseFormatEnabled()" class="ui-toggle mt-1" @click="toggleGlobalResponseFormat()">
                <span class="ui-toggle-thumb" />
              </button>
            </div>

            <div class="flex items-start gap-4 p-4 px-5">
              <div class="w-8 shrink-0" />
              <div class="flex-1 flex flex-col min-w-0">
                <h3 class="m-0 text-[13.5px] font-semibold text-[var(--color-text-primary)] leading-[1.3]">
                  Parallel Tool Calls
                </h3>
                <p class="m-0 text-[12px] text-[var(--color-text-tertiary)] leading-[1.4] mt-[3px]">
                  Allow models to call multiple tools simultaneously.
                </p>
                <div class="mt-3.5 mb-1">
                  <select class="w-[160px] h-8 px-3 rounded-[var(--radius-md)] border border-[var(--color-border-mid)] bg-[var(--color-bg-elevated)] text-[var(--color-text-primary)] text-[12.5px] outline-none focus:border-[var(--color-accent-dim)] shadow-sm" :value="globalParallelToolCalls() === undefined ? 'default' : globalParallelToolCalls()!.toString()" @change="onGlobalParallelToolCallsChange($event)">
                    <option value="default">
                      Provider Default
                    </option>
                    <option value="true">
                      Enabled
                    </option>
                    <option value="false">
                      Disabled
                    </option>
                  </select>
                </div>
              </div>
            </div>
          </section>

          <div class="flex items-center gap-3 mt-3 mb-1 shrink-0">
            <div class="flex-1 h-px bg-[var(--color-border-subtle)]" />
            <span class="text-[11px] font-semibold tracking-[0.08em] uppercase text-[var(--color-text-tertiary)] whitespace-nowrap">Context & Reasoning — Global</span>
            <div class="flex-1 h-px bg-[var(--color-border-subtle)]" />
          </div>

          <section class="bg-[var(--color-bg-surface)] border border-[var(--color-border-subtle)] rounded-[var(--radius-lg)] shrink-0 flex flex-col">
            <div class="flex items-start gap-4 p-4 px-5">
              <div class="grid place-items-center w-8 h-8 rounded-[var(--radius-md)] bg-[var(--color-bg-elevated)] text-[var(--color-text-secondary)] shrink-0 border border-[var(--color-border-subtle)] mt-0.5">
                <FileStack :size="16" :stroke-width="1.8" />
              </div>
              <div class="flex-1 flex flex-col min-w-0">
                <h3 class="m-0 text-[13.5px] font-semibold text-[var(--color-text-primary)] leading-[1.3]">
                  Context Window Limit
                </h3>
                <p class="m-0 text-[12px] text-[var(--color-text-tertiary)] leading-[1.4] mt-[3px]">
                  Override max context window limit globally. Set empty to use model defaults.
                </p>
                <div class="mt-3.5 mb-1 flex items-center gap-3">
                  <input
                    type="number"
                    class="w-[120px] h-8 px-2.5 rounded-[var(--radius-md)] border border-[var(--color-border-mid)] bg-[var(--color-bg-elevated)] text-[var(--color-text-primary)] font-mono text-[12.5px] outline-none focus:border-[var(--color-accent-dim)] shadow-sm"
                    placeholder="e.g. 128000"
                    :value="globalContextLimit() ?? ''"
                    min="1024" max="2000000" step="1024"
                    @input="settings.setProviderContext(null, 'contextLimit', ($event.target as HTMLInputElement).value ? Number(($event.target as HTMLInputElement).value) : undefined)"
                  >
                  <button v-if="globalContextLimit() !== undefined" class="text-[12px] font-medium text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] px-2 py-1 rounded-[var(--radius-sm)] transition-colors" @click="settings.setProviderContext(null, 'contextLimit', undefined)">
                    Clear
                  </button>
                </div>
              </div>
            </div>
          </section>

          <section class="bg-[var(--color-bg-surface)] border border-[var(--color-border-subtle)] rounded-[var(--radius-lg)] shrink-0 flex flex-col">
            <div class="flex items-start gap-4 p-4 px-5">
              <div class="grid place-items-center w-8 h-8 rounded-[var(--radius-md)] bg-[var(--color-bg-elevated)] text-[var(--color-text-secondary)] shrink-0 border border-[var(--color-border-subtle)] mt-0.5">
                <Brain :size="16" :stroke-width="1.8" />
              </div>
              <div class="flex-1 flex flex-col min-w-0">
                <h3 class="m-0 text-[13.5px] font-semibold text-[var(--color-text-primary)] leading-[1.3]">
                  Reasoning Budget
                </h3>
                <p class="m-0 text-[12px] text-[var(--color-text-tertiary)] leading-[1.4] mt-[3px]">
                  Custom thinking tokens override. When set, replaces the standard presets.
                </p>
                <div class="mt-3.5 mb-1 flex items-center gap-3">
                  <input
                    type="number"
                    class="w-[120px] h-8 px-2.5 rounded-[var(--radius-md)] border border-[var(--color-border-mid)] bg-[var(--color-bg-elevated)] text-[var(--color-text-primary)] font-mono text-[12.5px] outline-none focus:border-[var(--color-accent-dim)] shadow-sm"
                    placeholder="e.g. 16000"
                    :value="globalReasoningBudget() ?? ''"
                    min="512" max="100000" step="512"
                    @input="settings.setProviderReasoning(null, 'customBudgetTokens', ($event.target as HTMLInputElement).value ? Number(($event.target as HTMLInputElement).value) : undefined)"
                  >
                  <button v-if="globalReasoningBudget() !== undefined" class="text-[12px] font-medium text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] px-2 py-1 rounded-[var(--radius-sm)] transition-colors" @click="settings.setProviderReasoning(null, 'customBudgetTokens', undefined)">
                    Clear
                  </button>
                </div>
              </div>
            </div>
          </section>
        </div>
      </template>

      <!-- Provider view -->
      <template v-else-if="selectedProvider">
        <div class="flex items-center gap-4 px-6 py-4 border-b border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)] shrink-0 shadow-sm">
          <div class="grid place-items-center w-10 h-10 rounded-[var(--radius-md)] bg-white border border-zinc-200 shrink-0 shadow-sm">
            <template v-if="selectedProvider.id === 'openai'">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg" class="text-black"><path d="M22.2819 9.8211a5.9847 5.9847 0 0 0-.5157-4.9108 6.0462 6.0462 0 0 0-6.5098-2.9A6.0651 6.0651 0 0 0 4.9807 4.1818a5.9847 5.9847 0 0 0-3.9977 2.9 6.0462 6.0462 0 0 0 .7427 7.0966 5.98 5.98 0 0 0 .511 4.9107 6.051 6.051 0 0 0 6.5146 2.9001A5.9847 5.9847 0 0 0 13.2599 24a6.0557 6.0557 0 0 0 5.7718-4.2058 5.9894 5.9894 0 0 0 3.9977-2.9001 6.0557 6.0557 0 0 0-.7475-7.0729zm-9.022 12.6081a4.4755 4.4755 0 0 1-2.8764-1.0408l.1419-.0804 4.7783-2.7582a.7948.7948 0 0 0 .3927-.6813v-6.7369l2.02 1.1686a.071.071 0 0 1 .038.052v5.5826a4.504 4.504 0 0 1-4.4945 4.4944zm-9.6607-4.1254a4.4708 4.4708 0 0 1-.5346-3.0137l.142.0852 4.783 2.7582a.7712.7712 0 0 0 .7806 0l5.8428-3.3685v2.3324a.0804.0804 0 0 1-.0332.0615L9.74 19.9502a4.4992 4.4992 0 0 1-6.1408-1.6464zM2.3408 7.8956a4.485 4.485 0 0 1 2.3655-1.9728V11.6a.7664.7664 0 0 0 .3879.6765l5.8144 3.3543-2.0201 1.1685a.0757.0757 0 0 1-.071 0l-4.8303-2.7865A4.504 4.504 0 0 1 2.3408 7.872zm16.5963 3.8558L13.1038 8.364 15.1192 7.2a.0757.0757 0 0 1 .071 0l4.8303 2.7913a4.4944 4.4944 0 0 1-.6765 8.1042v-5.6772a.79.79 0 0 0-.407-.667zm2.0107-3.0231l-.142-.0852-4.7735-2.7818a.7759.7759 0 0 0-.7854 0L9.409 9.2297V6.8974a.0662.0662 0 0 1 .0284-.0615l4.8303-2.7866a4.4992 4.4992 0 0 1 6.6802 4.66zM8.3065 12.863l-2.02-1.1638a.0804.0804 0 0 1-.038-.0567V6.0742a4.4992 4.4992 0 0 1 7.3757-3.4537l-.142.0805L8.704 5.459a.7948.7948 0 0 0-.3927.6813zm1.0976-2.3654l2.602-1.4998 2.6069 1.4998v2.9994l-2.5974 1.4997-2.6067-1.4997Z" /></svg>
            </template>
            <template v-else-if="selectedProvider.id === 'anthropic'">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg" class="text-black"><path d="M13.827 3.52h3.603L24 20h-3.603l-6.57-16.48zm-3.654 0H6.57L0 20h3.603l1.498-3.818h6.404l-1.474-3.64H6.95l2.82-7.214 1.403 5.072z" /></svg>
            </template>
            <template v-else-if="selectedProvider.id === 'google'">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="var(--color-google-blue, #4285F4)" />
                <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="var(--color-google-green, #34A853)" />
                <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z" fill="var(--color-google-yellow, #FBBC05)" />
                <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="var(--color-google-red, #EA4335)" />
              </svg>
            </template>
            <template v-else-if="providerIconUrl(selectedProvider) && !failedIcons.has(selectedProvider.id)">
              <img :src="providerIconUrl(selectedProvider)!" class="w-6 h-6 object-contain block" :alt="selectedProvider.name" @error="onIconError(selectedProvider.id)">
            </template>
            <Puzzle v-else :size="24" :stroke-width="1.8" class="text-zinc-500" />
          </div>
          <div class="flex flex-col gap-0.5 min-w-0">
            <h2 class="m-0 text-[15px] font-semibold text-[var(--color-text-primary)] leading-[1.2]">
              {{ selectedProvider.name }}
            </h2>
            <span class="text-[12.5px] text-[var(--color-text-tertiary)] leading-[1.3] truncate">{{ selectedProvider.subtitle }}</span>
          </div>
          <span v-if="isCustomCompatible(selectedProvider)" class="ml-auto text-[10.5px] font-semibold tracking-[0.05em] uppercase px-[7px] py-[3px] rounded-[var(--radius-sm)] bg-[var(--color-accent-muted)] text-[var(--color-accent-text)] border border-[var(--color-accent-dim)] shrink-0">Custom Provider</span>
        </div>

        <div class="flex-1 min-h-0 overflow-y-auto px-6 py-5 pb-8 flex flex-col gap-5">
          <div class="flex items-start gap-3 p-3 px-4 rounded-[var(--radius-lg)] bg-[var(--color-accent-muted)] border border-[var(--color-accent-dim)] text-[var(--color-text-secondary)] text-[12.5px] leading-[1.5] shrink-0 mb-1">
            <Sparkles :size="16" :stroke-width="1.8" class="shrink-0 text-[var(--color-accent-text)] mt-[1px]" />
            <span class="flex-1">Provider-specific overrides for <strong>{{ selectedProvider.name }}</strong>. Inherits from Global when not set.</span>
          </div>

          <!-- Appearance - Provider -->
          <section class="bg-[var(--color-bg-surface)] border border-[var(--color-border-subtle)] rounded-[var(--radius-lg)] overflow-hidden shrink-0 flex flex-col divide-y divide-[var(--color-border-subtle)]">
            <div class="flex items-start gap-4 p-4 px-5">
              <div class="grid place-items-center w-8 h-8 rounded-[var(--radius-md)] bg-[var(--color-bg-elevated)] text-[var(--color-text-secondary)] shrink-0 border border-[var(--color-border-subtle)] mt-0.5">
                <EyeOff :size="16" :stroke-width="1.8" />
              </div>
              <div class="flex-1 flex flex-col min-w-0">
                <h3 class="m-0 text-[13.5px] font-semibold text-[var(--color-text-primary)] leading-[1.3]">
                  Hide thinking blocks
                </h3>
                <p class="m-0 text-[12px] text-[var(--color-text-tertiary)] leading-[1.4] mt-[3px]">
                  Hide the collapsible thinking/reasoning blocks in assistant messages.
                </p>
                <div class="mt-3.5 mb-1 inline-flex items-center gap-2 px-2.5 py-1.5 rounded-[var(--radius-sm)] border border-[var(--color-border-subtle)] bg-[var(--color-bg-elevated)] text-[11.5px] leading-[1.3] self-start" :class="effectiveValue(selectedProvider.id, 'hideThinking') ? 'text-[var(--color-text-secondary)]' : 'text-[var(--color-text-tertiary)]'">
                  <span class="w-1.5 h-1.5 rounded-full shrink-0" :class="effectiveValue(selectedProvider.id, 'hideThinking') ? 'bg-[var(--color-accent)]' : 'bg-[var(--color-border-mid)]'" />
                  <span>Effective: <strong class="text-[var(--color-text-primary)]">{{ effectiveValue(selectedProvider.id, 'hideThinking') ? 'Hidden' : 'Visible' }}</strong> <span class="text-[var(--color-text-tertiary)] ml-1">({{ perProviderValue(selectedProvider.id, 'hideThinking') ? 'Provider override' : (globalValue('hideThinking') ? 'Inherited from Global' : 'Default') }})</span></span>
                </div>
              </div>
              <button type="button" role="switch" :aria-checked="perProviderValue(selectedProvider.id, 'hideThinking')" class="ui-toggle mt-1" @click="setPerProvider(selectedProvider.id, 'hideThinking', !perProviderValue(selectedProvider.id, 'hideThinking'))">
                <span class="ui-toggle-thumb" />
              </button>
            </div>

            <div class="flex items-start gap-4 p-4 px-5">
              <div class="grid place-items-center w-8 h-8 rounded-[var(--radius-md)] bg-[var(--color-bg-elevated)] text-[var(--color-text-secondary)] shrink-0 border border-[var(--color-border-subtle)] mt-0.5">
                <Brain :size="16" :stroke-width="1.8" />
              </div>
              <div class="flex-1 flex flex-col min-w-0">
                <h3 class="m-0 text-[13.5px] font-semibold text-[var(--color-text-primary)] leading-[1.3]">
                  Turn off thinking markdown
                </h3>
                <p class="m-0 text-[12px] text-[var(--color-text-tertiary)] leading-[1.4] mt-[3px]">
                  Render thinking/reasoning as plain pre-wrapped text.
                </p>
                <div class="mt-3.5 mb-1 inline-flex items-center gap-2 px-2.5 py-1.5 rounded-[var(--radius-sm)] border border-[var(--color-border-subtle)] bg-[var(--color-bg-elevated)] text-[11.5px] leading-[1.3] self-start" :class="effectiveValue(selectedProvider.id, 'disableThinkingMarkdown') ? 'text-[var(--color-text-secondary)]' : 'text-[var(--color-text-tertiary)]'">
                  <span class="w-1.5 h-1.5 rounded-full shrink-0" :class="effectiveValue(selectedProvider.id, 'disableThinkingMarkdown') ? 'bg-[var(--color-accent)]' : 'bg-[var(--color-border-mid)]'" />
                  <span>Effective: <strong class="text-[var(--color-text-primary)]">{{ effectiveValue(selectedProvider.id, 'disableThinkingMarkdown') ? 'Disabled' : 'Enabled' }}</strong> <span class="text-[var(--color-text-tertiary)] ml-1">({{ perProviderValue(selectedProvider.id, 'disableThinkingMarkdown') ? 'Provider override' : (globalValue('disableThinkingMarkdown') ? 'Inherited from Global' : 'Default') }})</span></span>
                </div>
              </div>
              <button type="button" role="switch" :aria-checked="perProviderValue(selectedProvider.id, 'disableThinkingMarkdown')" class="ui-toggle mt-1" @click="setPerProvider(selectedProvider.id, 'disableThinkingMarkdown', !perProviderValue(selectedProvider.id, 'disableThinkingMarkdown'))">
                <span class="ui-toggle-thumb" />
              </button>
            </div>

            <div class="flex items-start gap-4 p-4 px-5">
              <div class="grid place-items-center w-8 h-8 rounded-[var(--radius-md)] bg-[var(--color-bg-elevated)] text-[var(--color-text-secondary)] shrink-0 border border-[var(--color-border-subtle)] mt-0.5">
                <FileText :size="16" :stroke-width="1.8" />
              </div>
              <div class="flex-1 flex flex-col min-w-0">
                <h3 class="m-0 text-[13.5px] font-semibold text-[var(--color-text-primary)] leading-[1.3]">
                  Turn off assistant message markdown
                </h3>
                <p class="m-0 text-[12px] text-[var(--color-text-tertiary)] leading-[1.4] mt-[3px]">
                  Render regular assistant messages as plain text.
                </p>
                <div class="mt-3.5 mb-1 inline-flex items-center gap-2 px-2.5 py-1.5 rounded-[var(--radius-sm)] border border-[var(--color-border-subtle)] bg-[var(--color-bg-elevated)] text-[11.5px] leading-[1.3] self-start" :class="effectiveValue(selectedProvider.id, 'disableAssistantMarkdown') ? 'text-[var(--color-text-secondary)]' : 'text-[var(--color-text-tertiary)]'">
                  <span class="w-1.5 h-1.5 rounded-full shrink-0" :class="effectiveValue(selectedProvider.id, 'disableAssistantMarkdown') ? 'bg-[var(--color-accent)]' : 'bg-[var(--color-border-mid)]'" />
                  <span>Effective: <strong class="text-[var(--color-text-primary)]">{{ effectiveValue(selectedProvider.id, 'disableAssistantMarkdown') ? 'Disabled' : 'Enabled' }}</strong> <span class="text-[var(--color-text-tertiary)] ml-1">({{ perProviderValue(selectedProvider.id, 'disableAssistantMarkdown') ? 'Provider override' : (globalValue('disableAssistantMarkdown') ? 'Inherited from Global' : 'Default') }})</span></span>
                </div>
              </div>
              <button type="button" role="switch" :aria-checked="perProviderValue(selectedProvider.id, 'disableAssistantMarkdown')" class="ui-toggle mt-1" @click="setPerProvider(selectedProvider.id, 'disableAssistantMarkdown', !perProviderValue(selectedProvider.id, 'disableAssistantMarkdown'))">
                <span class="ui-toggle-thumb" />
              </button>
            </div>
          </section>

          <div class="flex items-center gap-3 mt-3 mb-1 shrink-0">
            <div class="flex-1 h-px bg-[var(--color-border-subtle)]" />
            <span class="text-[11px] font-semibold tracking-[0.08em] uppercase text-[var(--color-text-tertiary)] whitespace-nowrap">Generation Sampling — {{ selectedProvider.name }}</span>
            <div class="flex-1 h-px bg-[var(--color-border-subtle)]" />
          </div>

          <section v-for="param in SAMPLING_PARAMS" :key="param.key" class="bg-[var(--color-bg-surface)] border border-[var(--color-border-subtle)] rounded-[var(--radius-lg)] overflow-hidden shrink-0 flex flex-col transition-colors">
            <div class="flex items-start gap-4 p-4 px-5">
              <div class="grid place-items-center w-8 h-8 rounded-[var(--radius-md)] bg-[var(--color-bg-elevated)] text-[var(--color-text-secondary)] shrink-0 border border-[var(--color-border-subtle)] mt-0.5">
                <component :is="param.icon" :size="16" :stroke-width="1.8" />
              </div>
              <div class="flex-1 flex flex-col min-w-0">
                <div class="flex items-center gap-2">
                  <h3 class="m-0 text-[13.5px] font-semibold text-[var(--color-text-primary)] leading-[1.3]">
                    {{ param.label }}
                  </h3>
                </div>
                <p class="m-0 text-[12px] text-[var(--color-text-tertiary)] leading-[1.4] mt-[3px]">
                  {{ param.desc }}
                </p>

                <div v-if="isPerSamplingEnabled(selectedProvider.id, param.key)" class="mt-4 flex items-center gap-4">
                  <input
                    type="range"
                    class="pm-slider flex-1 min-w-0 h-1 appearance-none bg-[var(--color-border-mid)] rounded-full outline-none cursor-pointer"
                    :min="param.min"
                    :max="param.max"
                    :step="param.step"
                    :value="perSamplingValue(selectedProvider.id, param.key)!"
                    @input="onPerSliderInput(selectedProvider.id, param.key, $event)"
                  >
                  <input
                    type="number"
                    class="w-[72px] h-7 px-2 rounded-[var(--radius-md)] border border-[var(--color-border-mid)] bg-[var(--color-bg-elevated)] text-[var(--color-text-primary)] font-mono text-[12px] outline-none focus:border-[var(--color-accent-dim)] focus:ring-2 focus:ring-[color-mix(in_srgb,var(--color-accent)_20%,transparent)]"
                    :min="param.min"
                    :max="param.max"
                    :step="param.step"
                    :value="perSamplingValue(selectedProvider.id, param.key)"
                    @input="onPerSliderInput(selectedProvider.id, param.key, $event)"
                  >
                </div>

                <div class="mt-3.5 mb-1 inline-flex items-center gap-2 px-2.5 py-1.5 rounded-[var(--radius-sm)] border border-[var(--color-border-subtle)] bg-[var(--color-bg-elevated)] text-[11.5px] leading-[1.3] self-start" :class="effectiveSamplingValue(selectedProvider.id, param.key) !== undefined ? 'text-[var(--color-text-secondary)]' : 'text-[var(--color-text-tertiary)]'">
                  <span class="w-1.5 h-1.5 rounded-full shrink-0" :class="effectiveSamplingValue(selectedProvider.id, param.key) !== undefined ? 'bg-[var(--color-accent)]' : 'bg-[var(--color-border-mid)]'" />
                  <span v-if="effectiveSamplingValue(selectedProvider.id, param.key) !== undefined">
                    Effective: <strong class="text-[var(--color-text-primary)] font-mono">{{ formatSamplingValue(param.key, effectiveSamplingValue(selectedProvider.id, param.key)) }}</strong>
                    <span class="text-[var(--color-text-tertiary)] ml-1">
                      ({{ perSamplingValue(selectedProvider.id, param.key) !== undefined ? 'Provider override' : 'Inherited from Global' }})
                    </span>
                  </span>
                  <span v-else>Using model default</span>
                </div>
              </div>
              <button type="button" role="switch" :aria-checked="isPerSamplingEnabled(selectedProvider.id, param.key)" class="ui-toggle mt-1" @click="togglePerSampling(selectedProvider.id, param.key)">
                <span class="ui-toggle-thumb" />
              </button>
            </div>
          </section>

          <section class="bg-[var(--color-bg-surface)] border border-[var(--color-border-subtle)] rounded-[var(--radius-lg)] overflow-hidden shrink-0 flex flex-col">
            <div class="flex items-start gap-4 p-4 px-5">
              <div class="grid place-items-center w-8 h-8 rounded-[var(--radius-md)] bg-[var(--color-bg-elevated)] text-[var(--color-text-secondary)] shrink-0 border border-[var(--color-border-subtle)] mt-0.5">
                <FileText :size="16" :stroke-width="1.8" />
              </div>
              <div class="flex-1 flex flex-col min-w-0">
                <h3 class="m-0 text-[13.5px] font-semibold text-[var(--color-text-primary)] leading-[1.3]">
                  Stop Sequences
                </h3>
                <p class="m-0 text-[12px] text-[var(--color-text-tertiary)] leading-[1.4] mt-[3px]">
                  Strings that immediately stop generation.
                </p>

                <div v-if="isPerStopEnabled(selectedProvider.id)" class="mt-3.5">
                  <textarea
                    class="w-full min-h-[60px] p-2.5 px-3 rounded-[var(--radius-md)] border border-[var(--color-border-mid)] bg-[var(--color-bg-elevated)] text-[var(--color-text-primary)] font-mono text-[12.5px] leading-[1.5] resize-y outline-none focus:border-[var(--color-accent-dim)] focus:ring-2 focus:ring-[color-mix(in_srgb,var(--color-accent)_20%,transparent)] shadow-sm"
                    rows="2"
                    placeholder="e.g. <STOP>, END"
                    :value="(perStopSequences(selectedProvider.id) ?? []).join(', ')"
                    @input="onPerStopInput(selectedProvider.id, $event)"
                  />
                </div>

                <div class="mt-3.5 mb-1 inline-flex items-center gap-2 px-2.5 py-1.5 rounded-[var(--radius-sm)] border border-[var(--color-border-subtle)] bg-[var(--color-bg-elevated)] text-[11.5px] leading-[1.3] self-start" :class="effectiveStopSequences(selectedProvider.id) ? 'text-[var(--color-text-secondary)]' : 'text-[var(--color-text-tertiary)]'">
                  <span class="w-1.5 h-1.5 rounded-full shrink-0" :class="effectiveStopSequences(selectedProvider.id) ? 'bg-[var(--color-accent)]' : 'bg-[var(--color-border-mid)]'" />
                  <span v-if="effectiveStopSequences(selectedProvider.id)">
                    Effective Stop: <strong class="text-[var(--color-text-primary)] font-mono">{{ effectiveStopSequences(selectedProvider.id)!.join(', ') }}</strong>
                    <span class="text-[var(--color-text-tertiary)] ml-1">({{ perStopSequences(selectedProvider.id) ? 'Provider override' : 'Inherited from Global' }})</span>
                  </span>
                  <span v-else>Using model default stop sequences</span>
                </div>
              </div>
              <button type="button" role="switch" :aria-checked="isPerStopEnabled(selectedProvider.id)" class="ui-toggle mt-1" @click="togglePerStop(selectedProvider.id)">
                <span class="ui-toggle-thumb" />
              </button>
            </div>
          </section>

          <section class="bg-[var(--color-bg-surface)] border border-[var(--color-border-subtle)] rounded-[var(--radius-lg)] shrink-0 flex flex-col divide-y divide-[var(--color-border-subtle)]">
            <div class="flex items-start gap-4 p-4 px-5">
              <div class="grid place-items-center w-8 h-8 rounded-[var(--radius-md)] bg-[var(--color-bg-elevated)] text-[var(--color-text-secondary)] shrink-0 border border-[var(--color-border-subtle)] mt-0.5">
                <Sparkles :size="16" :stroke-width="1.8" />
              </div>
              <div class="flex-1 flex flex-col min-w-0">
                <h3 class="m-0 text-[13.5px] font-semibold text-[var(--color-text-primary)] leading-[1.3]">
                  JSON Mode
                </h3>
                <p class="m-0 text-[12px] text-[var(--color-text-tertiary)] leading-[1.4] mt-[3px]">
                  Force structured JSON output format for this provider.
                </p>
                <div v-if="isPerResponseFormatEnabled(selectedProvider.id)" class="mt-3.5">
                  <select class="w-[180px] h-8 px-3 rounded-[var(--radius-md)] border border-[var(--color-border-mid)] bg-[var(--color-bg-elevated)] text-[var(--color-text-primary)] text-[12.5px] outline-none focus:border-[var(--color-accent-dim)] shadow-sm" :value="perResponseFormat(selectedProvider.id)" @change="onPerResponseFormatChange(selectedProvider.id, $event)">
                    <option value="text">
                      text
                    </option>
                    <option value="json_object">
                      json_object
                    </option>
                    <option value="json_schema">
                      json_schema
                    </option>
                  </select>
                </div>

                <div class="mt-3.5 mb-1 inline-flex items-center gap-2 px-2.5 py-1.5 rounded-[var(--radius-sm)] border border-[var(--color-border-subtle)] bg-[var(--color-bg-elevated)] text-[11.5px] leading-[1.3] self-start text-[var(--color-text-secondary)]">
                  <span class="w-1.5 h-1.5 rounded-full shrink-0 bg-[var(--color-accent)]" />
                  <span>Effective: <strong class="text-[var(--color-text-primary)]">{{ isPerResponseFormatEnabled(selectedProvider.id) ? perResponseFormat(selectedProvider.id) : (globalResponseFormat() ?? 'text') }}</strong> <span class="text-[var(--color-text-tertiary)] ml-1">({{ isPerResponseFormatEnabled(selectedProvider.id) ? 'Provider override' : (globalResponseFormat() ? 'Inherited from Global' : 'Default') }})</span></span>
                </div>
              </div>
              <button type="button" role="switch" :aria-checked="isPerResponseFormatEnabled(selectedProvider.id)" class="ui-toggle mt-1" @click="togglePerResponseFormat(selectedProvider.id)">
                <span class="ui-toggle-thumb" />
              </button>
            </div>

            <div class="flex items-start gap-4 p-4 px-5">
              <div class="w-8 shrink-0" />
              <div class="flex-1 flex flex-col min-w-0">
                <h3 class="m-0 text-[13.5px] font-semibold text-[var(--color-text-primary)] leading-[1.3]">
                  Parallel Tool Calls
                </h3>
                <p class="m-0 text-[12px] text-[var(--color-text-tertiary)] leading-[1.4] mt-[3px]">
                  Allow model to call multiple tools simultaneously.
                </p>
                <div class="mt-3.5 mb-1">
                  <select class="w-[160px] h-8 px-3 rounded-[var(--radius-md)] border border-[var(--color-border-mid)] bg-[var(--color-bg-elevated)] text-[var(--color-text-primary)] text-[12.5px] outline-none focus:border-[var(--color-accent-dim)] shadow-sm" :value="perParallelToolCalls(selectedProvider.id) === undefined ? 'default' : perParallelToolCalls(selectedProvider.id)!.toString()" @change="onPerParallelToolCallsChange(selectedProvider.id, $event)">
                    <option value="default">
                      Inherit
                    </option>
                    <option value="true">
                      Enabled
                    </option>
                    <option value="false">
                      Disabled
                    </option>
                  </select>
                </div>

                <div class="mt-2.5 mb-1 inline-flex items-center gap-2 px-2.5 py-1.5 rounded-[var(--radius-sm)] border border-[var(--color-border-subtle)] bg-[var(--color-bg-elevated)] text-[11.5px] leading-[1.3] self-start" :class="effectiveParallelToolCalls(selectedProvider.id) !== undefined ? 'text-[var(--color-text-secondary)]' : 'text-[var(--color-text-tertiary)]'">
                  <span class="w-1.5 h-1.5 rounded-full shrink-0" :class="effectiveParallelToolCalls(selectedProvider.id) !== undefined ? 'bg-[var(--color-accent)]' : 'bg-[var(--color-border-mid)]'" />
                  <span v-if="effectiveParallelToolCalls(selectedProvider.id) !== undefined">Effective: <strong class="text-[var(--color-text-primary)]">{{ effectiveParallelToolCalls(selectedProvider.id) ? 'Enabled' : 'Disabled' }}</strong> <span class="text-[var(--color-text-tertiary)] ml-1">({{ perParallelToolCalls(selectedProvider.id) !== undefined ? 'Provider override' : 'Inherited from Global' }})</span></span>
                  <span v-else>Using provider default</span>
                </div>
              </div>
            </div>
          </section>

          <div class="flex items-center gap-3 mt-3 mb-1 shrink-0">
            <div class="flex-1 h-px bg-[var(--color-border-subtle)]" />
            <span class="text-[11px] font-semibold tracking-[0.08em] uppercase text-[var(--color-text-tertiary)] whitespace-nowrap">Context & Reasoning — {{ selectedProvider.name }}</span>
            <div class="flex-1 h-px bg-[var(--color-border-subtle)]" />
          </div>

          <section class="bg-[var(--color-bg-surface)] border border-[var(--color-border-subtle)] rounded-[var(--radius-lg)] shrink-0 flex flex-col">
            <div class="flex items-start gap-4 p-4 px-5">
              <div class="grid place-items-center w-8 h-8 rounded-[var(--radius-md)] bg-[var(--color-bg-elevated)] text-[var(--color-text-secondary)] shrink-0 border border-[var(--color-border-subtle)] mt-0.5">
                <FileStack :size="16" :stroke-width="1.8" />
              </div>
              <div class="flex-1 flex flex-col min-w-0">
                <h3 class="m-0 text-[13.5px] font-semibold text-[var(--color-text-primary)] leading-[1.3]">
                  Context Window Limit
                </h3>
                <p class="m-0 text-[12px] text-[var(--color-text-tertiary)] leading-[1.4] mt-[3px]">
                  Override max context window limit for this provider.
                </p>
                <div class="mt-3.5 mb-1 flex items-center gap-3">
                  <input
                    type="number"
                    class="w-[120px] h-8 px-2.5 rounded-[var(--radius-md)] border border-[var(--color-border-mid)] bg-[var(--color-bg-elevated)] text-[var(--color-text-primary)] font-mono text-[12.5px] outline-none focus:border-[var(--color-accent-dim)] shadow-sm"
                    placeholder="e.g. 128000"
                    :value="perContextLimit(selectedProvider.id) ?? ''"
                    min="1024" max="2000000" step="1024"
                    @input="settings.setProviderContext(selectedProvider.id, 'contextLimit', ($event.target as HTMLInputElement).value ? Number(($event.target as HTMLInputElement).value) : undefined)"
                  >
                  <button v-if="perContextLimit(selectedProvider.id) !== undefined" class="text-[12px] font-medium text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] px-2 py-1 rounded-[var(--radius-sm)] transition-colors" @click="settings.setProviderContext(selectedProvider.id, 'contextLimit', undefined)">
                    Clear
                  </button>
                </div>

                <div class="mt-3.5 mb-1 inline-flex items-center gap-2 px-2.5 py-1.5 rounded-[var(--radius-sm)] border border-[var(--color-border-subtle)] bg-[var(--color-bg-elevated)] text-[11.5px] leading-[1.3] self-start" :class="effectiveContextLimit(selectedProvider.id) !== undefined ? 'text-[var(--color-text-secondary)]' : 'text-[var(--color-text-tertiary)]'">
                  <span class="w-1.5 h-1.5 rounded-full shrink-0" :class="effectiveContextLimit(selectedProvider.id) !== undefined ? 'bg-[var(--color-accent)]' : 'bg-[var(--color-border-mid)]'" />
                  <span v-if="effectiveContextLimit(selectedProvider.id) !== undefined">Effective: <strong class="text-[var(--color-text-primary)] font-mono">{{ effectiveContextLimit(selectedProvider.id)!.toLocaleString() }} tokens</strong> <span class="text-[var(--color-text-tertiary)] ml-1">({{ perContextLimit(selectedProvider.id) !== undefined ? 'Provider override' : 'Inherited from Global' }})</span></span>
                  <span v-else>Using model default context limits</span>
                </div>
              </div>
            </div>
          </section>

          <section class="bg-[var(--color-bg-surface)] border border-[var(--color-border-subtle)] rounded-[var(--radius-lg)] shrink-0 flex flex-col">
            <div class="flex items-start gap-4 p-4 px-5">
              <div class="grid place-items-center w-8 h-8 rounded-[var(--radius-md)] bg-[var(--color-bg-elevated)] text-[var(--color-text-secondary)] shrink-0 border border-[var(--color-border-subtle)] mt-0.5">
                <Brain :size="16" :stroke-width="1.8" />
              </div>
              <div class="flex-1 flex flex-col min-w-0">
                <h3 class="m-0 text-[13.5px] font-semibold text-[var(--color-text-primary)] leading-[1.3]">
                  Reasoning Budget
                </h3>
                <p class="m-0 text-[12px] text-[var(--color-text-tertiary)] leading-[1.4] mt-[3px]">
                  Custom thinking tokens override. When set, replaces the standard presets.
                </p>
                <div class="mt-3.5 mb-1 flex items-center gap-3">
                  <input
                    type="number"
                    class="w-[120px] h-8 px-2.5 rounded-[var(--radius-md)] border border-[var(--color-border-mid)] bg-[var(--color-bg-elevated)] text-[var(--color-text-primary)] font-mono text-[12.5px] outline-none focus:border-[var(--color-accent-dim)] shadow-sm"
                    placeholder="e.g. 16000"
                    :value="perReasoningBudget(selectedProvider.id) ?? ''"
                    min="512" max="100000" step="512"
                    @input="settings.setProviderReasoning(selectedProvider.id, 'customBudgetTokens', ($event.target as HTMLInputElement).value ? Number(($event.target as HTMLInputElement).value) : undefined)"
                  >
                  <button v-if="perReasoningBudget(selectedProvider.id) !== undefined" class="text-[12px] font-medium text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] px-2 py-1 rounded-[var(--radius-sm)] transition-colors" @click="settings.setProviderReasoning(selectedProvider.id, 'customBudgetTokens', undefined)">
                    Clear
                  </button>
                </div>

                <div class="mt-3.5 mb-1 inline-flex items-center gap-2 px-2.5 py-1.5 rounded-[var(--radius-sm)] border border-[var(--color-border-subtle)] bg-[var(--color-bg-elevated)] text-[11.5px] leading-[1.3] self-start" :class="effectiveReasoningBudget(selectedProvider.id) !== undefined ? 'text-[var(--color-text-secondary)]' : 'text-[var(--color-text-tertiary)]'">
                  <span class="w-1.5 h-1.5 rounded-full shrink-0" :class="effectiveReasoningBudget(selectedProvider.id) !== undefined ? 'bg-[var(--color-accent)]' : 'bg-[var(--color-border-mid)]'" />
                  <span v-if="effectiveReasoningBudget(selectedProvider.id) !== undefined">Effective: <strong class="text-[var(--color-text-primary)] font-mono">{{ effectiveReasoningBudget(selectedProvider.id)!.toLocaleString() }} tokens</strong> <span class="text-[var(--color-text-tertiary)] ml-1">({{ perReasoningBudget(selectedProvider.id) !== undefined ? 'Provider override' : 'Inherited from Global' }})</span></span>
                  <span v-else>Using Preset</span>
                </div>
              </div>
            </div>
          </section>

          <div class="flex items-center gap-3 mt-3 mb-1 shrink-0">
            <div class="flex-1 h-px bg-[var(--color-border-subtle)]" />
            <span class="text-[11px] font-semibold tracking-[0.08em] uppercase text-[var(--color-text-tertiary)] whitespace-nowrap">Per-Model Overrides — {{ selectedProvider.name }}</span>
            <div class="flex-1 h-px bg-[var(--color-border-subtle)]" />
          </div>

          <div class="flex items-start gap-3 p-3 px-4 rounded-[var(--radius-lg)] bg-[var(--color-accent-muted)] border border-[var(--color-accent-dim)] text-[var(--color-text-secondary)] text-[12.5px] leading-[1.5] shrink-0 mb-1">
            <Hash :size="16" :stroke-width="1.8" class="shrink-0 text-[var(--color-accent-text)] mt-[1px]" />
            <span>Override sampling and context per exact model. Model overrides win over provider and global defaults.</span>
          </div>

          <section class="bg-[var(--color-bg-surface)] border border-[var(--color-border-subtle)] rounded-[var(--radius-lg)] overflow-hidden shrink-0">
            <div v-if="modelsForSelectedProvider.length === 0" class="p-6 text-center text-[12.5px] text-[var(--color-text-tertiary)] leading-[1.5]">
              No models discovered for {{ selectedProvider.name }} yet.<br>Connect and refresh models to configure per-model overrides.
            </div>

            <div v-else class="flex flex-col divide-y divide-[var(--color-border-subtle)]">
              <div v-for="m in modelsForSelectedProvider" :key="m.uid" class="flex flex-col">
                <button type="button" class="flex items-center gap-3 w-full px-5 py-3.5 bg-transparent border-0 cursor-pointer text-left hover:bg-[var(--color-bg-surface-hover)] transition-colors group" @click="toggleModelExpand(m.uid)">
                  <div class="flex flex-col min-w-0 flex-1 gap-1">
                    <span class="text-[13.5px] font-semibold text-[var(--color-text-primary)] truncate">{{ m.name }}</span>
                    <span class="font-mono text-[11px] text-[var(--color-text-tertiary)] truncate group-hover:text-[var(--color-text-secondary)] transition-colors">{{ m.id }}</span>
                  </div>
                  <span v-if="(modelSampling[m.uid] ? Object.keys(modelSampling[m.uid]!).length : 0) > 0" class="text-[10.5px] font-semibold px-2 py-0.5 rounded-[var(--radius-sm)] bg-[var(--color-accent-muted)] text-[var(--color-accent-text)] whitespace-nowrap">{{ Object.keys(modelSampling[m.uid]!).length }} overrides</span>
                  <span class="text-[16px] text-[var(--color-text-tertiary)] w-5 text-center shrink-0 transition-transform duration-[200ms] ease-out" :class="{ 'rotate-90': isModelExpanded(m.uid) }">›</span>
                </button>

                <div v-if="isModelExpanded(m.uid)" class="flex flex-col gap-0 bg-[var(--color-bg-elevated)] border-t border-[var(--color-border-subtle)] shadow-inner pb-2 pt-1">
                  <div v-for="param in SAMPLING_PARAMS" :key="param.key" class="flex flex-col gap-2 p-3 px-5 border-b border-[var(--color-border-subtle)] border-opacity-50 last:border-0 hover:bg-[var(--color-bg-surface)] transition-colors">
                    <div class="flex items-center justify-between gap-4">
                      <span class="text-[13px] font-medium text-[var(--color-text-primary)]">{{ param.label }}</span>
                      <button type="button" class="inline-flex items-center justify-center min-w-[64px] h-7 px-2.5 rounded-[var(--radius-sm)] border text-[11.5px] font-medium cursor-pointer transition-colors whitespace-nowrap" :class="isModelSamplingEnabled(m.uid, param.key) ? 'bg-[var(--color-accent-muted)] border-[var(--color-accent-dim)] text-[var(--color-accent-text)]' : 'bg-transparent border-[var(--color-border-mid)] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-bg-surface-hover)]'" @click="toggleModelSampling(m.uid, param.key)">
                        {{ isModelSamplingEnabled(m.uid, param.key) ? 'Override' : 'Inherit' }}
                      </button>
                    </div>
                    <div v-if="isModelSamplingEnabled(m.uid, param.key)" class="flex items-center gap-4 pt-1 pb-1">
                      <input
                        type="range"
                        class="pm-slider flex-1 min-w-0 h-1.5 appearance-none bg-[var(--color-border-mid)] rounded-full outline-none cursor-pointer"
                        :min="param.min" :max="param.max" :step="param.step"
                        :value="(modelSamplingValue(m.uid, param.key) as number) ?? param.default"
                        @input="onModelSliderInput(m.uid, param.key, $event)"
                      >
                      <input
                        type="number"
                        class="w-[72px] h-7 px-2 rounded-[var(--radius-md)] border border-[var(--color-border-mid)] bg-[var(--color-bg-surface)] text-[var(--color-text-primary)] font-mono text-[12px] outline-none focus:border-[var(--color-accent-dim)] focus:ring-2 focus:ring-[color-mix(in_srgb,var(--color-accent)_20%,transparent)] shadow-sm"
                        :min="param.min" :max="param.max" :step="param.step"
                        :value="modelSamplingValue(m.uid, param.key) as number"
                        @input="onModelSliderInput(m.uid, param.key, $event)"
                      >
                    </div>
                  </div>

                  <div class="flex flex-col gap-2 p-3 px-5 hover:bg-[var(--color-bg-surface)] transition-colors">
                    <div class="flex items-center justify-between gap-4">
                      <span class="text-[13px] font-medium text-[var(--color-text-primary)]">Context Limit</span>
                      <button type="button" class="inline-flex items-center justify-center min-w-[64px] h-7 px-2.5 rounded-[var(--radius-sm)] border text-[11.5px] font-medium cursor-pointer transition-colors whitespace-nowrap" :class="isModelSamplingEnabled(m.uid, 'contextLimit') ? 'bg-[var(--color-accent-muted)] border-[var(--color-accent-dim)] text-[var(--color-accent-text)]' : 'bg-transparent border-[var(--color-border-mid)] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-bg-surface-hover)]'" @click="toggleModelSampling(m.uid, 'contextLimit')">
                        {{ isModelSamplingEnabled(m.uid, 'contextLimit') ? 'Override' : 'Inherit' }}
                      </button>
                    </div>
                    <div v-if="isModelSamplingEnabled(m.uid, 'contextLimit')" class="flex items-center gap-4 pt-1 pb-1">
                      <input type="number" class="w-[120px] h-7 px-2.5 rounded-[var(--radius-md)] border border-[var(--color-border-mid)] bg-[var(--color-bg-surface)] text-[var(--color-text-primary)] font-mono text-[12px] outline-none focus:border-[var(--color-accent-dim)] shadow-sm" :value="modelSamplingValue(m.uid, 'contextLimit') as number" placeholder="e.g. 128000" @input="onModelSliderInput(m.uid, 'contextLimit', $event)">
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </section>
        </div>
      </template>

      <template v-else>
        <div class="flex-1 flex flex-col items-center justify-center gap-2 p-6 text-center">
          <Puzzle :size="24" :stroke-width="1.6" class="text-[var(--color-text-dim)]" />
          <p class="text-[13.5px] font-semibold text-[var(--color-text-secondary)] mt-2">
            Provider not found
          </p>
          <p class="text-[12.5px] text-[var(--color-text-tertiary)] text-center max-w-[280px] leading-[1.5]">
            Select Global Settings or a configured provider from the left sidebar.
          </p>
        </div>
      </template>
    </div>
  </div>
</template>

<style scoped>
.ui-toggle {
  position: relative;
  display: flex;
  align-items: center;
  width: 34px;
  height: 20px;
  border-radius: 9999px;
  border: 1px solid var(--color-border-mid);
  background: var(--color-toggle-track-off);
  flex-shrink: 0;
  transition: all 140ms ease-in-out;
  padding: 0;
  cursor: pointer;
}
.ui-toggle[aria-checked='true'] {
  background: var(--color-toggle-track-on);
  border-color: var(--color-accent);
}
.ui-toggle-thumb {
  position: absolute;
  left: 2px;
  width: 14px;
  height: 14px;
  border-radius: 9999px;
  background: var(--color-toggle-thumb-off);
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.25);
  transition: transform 140ms cubic-bezier(0.4, 0, 0.2, 1);
}
.ui-toggle[aria-checked='true'] .ui-toggle-thumb {
  transform: translateX(14px);
  background: var(--color-text-primary);
}

.pm-slider::-webkit-slider-thumb {
  appearance: none;
  width: 16px;
  height: 16px;
  border-radius: 50%;
  background: var(--color-accent);
  border: 2px solid var(--color-bg-surface);
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.3);
  cursor: pointer;
  transition: transform 120ms ease;
}
.pm-slider::-webkit-slider-thumb:hover {
  transform: scale(1.15);
}
.pm-slider::-moz-range-thumb {
  width: 16px;
  height: 16px;
  border-radius: 50%;
  background: var(--color-accent);
  border: 2px solid var(--color-bg-surface);
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.3);
  cursor: pointer;
}
</style>
