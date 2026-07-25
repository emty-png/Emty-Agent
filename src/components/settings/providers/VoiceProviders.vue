<script setup lang="ts">
import type { SttProvider, TtsProvider } from '@/stores/settings/voiceTypes'
import { Loader, Mic, Plus, Volume2, X, Zap } from 'lucide-vue-next'
import { storeToRefs } from 'pinia'
import { watch } from 'vue'
import { useSettingsStore } from '@/stores/settings'
import ProviderCard from './ProviderCard.vue'

const s = useSettingsStore()
const { sttProvider, stt, ttsProvider, tts, voiceProcessing, voiceDictionary, voiceSnippets } = storeToRefs(s)

function addDictionaryEntry() {
  voiceDictionary.value = [...voiceDictionary.value, { wrong: '', correct: '' }]
}

function removeDictionaryEntry(index: number) {
  voiceDictionary.value = voiceDictionary.value.filter((_, i) => i !== index)
}

function addSnippet() {
  voiceSnippets.value = [...voiceSnippets.value, { trigger: '', expansion: '' }]
}

function removeSnippet(index: number) {
  voiceSnippets.value = voiceSnippets.value.filter((_, i) => i !== index)
}

const autoTestTimers = new Map<string, ReturnType<typeof window.setTimeout>>()

function clearAutoTest(key: string) {
  const timer = autoTestTimers.get(key)
  if (timer) {
    clearTimeout(timer)
    autoTestTimers.delete(key)
  }
}

function scheduleAutoTest(key: string, task: () => Promise<void>) {
  clearAutoTest(key)
  autoTestTimers.set(key, window.setTimeout(() => {
    autoTestTimers.delete(key)
    void task()
  }, 700))
}

// ── STT provider definitions ───────────────────────────────────────────────────

interface SttDef {
  id: SttProvider
  name: string
  url: string
  logoClass: string
  keyPlaceholder: string
  hintHtml: string
  needsBaseUrl?: boolean
}

const sttProviders: SttDef[] = [
  {
    id: 'openai',
    name: 'OpenAI',
    url: 'api.openai.com',
    logoClass: 'openai-logo',
    keyPlaceholder: 'sk-...',
    hintHtml: 'Whisper / gpt-4o-transcribe. Get a key at <a href="https://platform.openai.com" target="_blank" rel="noopener">platform.openai.com</a>.',
  },
  {
    id: 'deepgram',
    name: 'Deepgram',
    url: 'api.deepgram.com',
    logoClass: 'deepgram-logo',
    keyPlaceholder: 'dg...',
    hintHtml: 'Nova-3 model. Get a key at <a href="https://console.deepgram.com/signup" target="_blank" rel="noopener">console.deepgram.com</a>. $200 free credit.',
  },
  {
    id: 'assemblyai',
    name: 'AssemblyAI',
    url: 'api.assemblyai.com',
    logoClass: 'assemblyai-logo',
    keyPlaceholder: '...',
    hintHtml: 'Universal-3.5 model. Get a key at <a href="https://www.assemblyai.com/dashboard" target="_blank" rel="noopener">assemblyai.com</a>.',
  },
  {
    id: 'google',
    name: 'Google Cloud',
    url: 'speech.googleapis.com',
    logoClass: 'google-logo',
    keyPlaceholder: 'AIza...',
    hintHtml: 'Speech-to-Text API. Get a key at <a href="https://console.cloud.google.com/apis/credentials" target="_blank" rel="noopener">console.cloud.google.com</a>.',
  },
  {
    id: 'azure',
    name: 'Azure Speech',
    url: 'cognitiveservices.azure.com',
    logoClass: 'azure-logo',
    keyPlaceholder: '...',
    hintHtml: 'Azure Cognitive Services Speech. Get a key at <a href="https://portal.azure.com" target="_blank" rel="noopener">portal.azure.com</a>.',
  },
  {
    id: 'custom',
    name: 'Custom (OpenAI-compatible)',
    url: 'custom endpoint',
    logoClass: 'custom-logo',
    keyPlaceholder: '...',
    needsBaseUrl: true,
    hintHtml: 'Any OpenAI-compatible speech-to-text endpoint.',
  },
]

// ── TTS provider definitions ───────────────────────────────────────────────────

interface TtsDef {
  id: TtsProvider
  name: string
  url: string
  logoClass: string
  keyPlaceholder: string
  hintHtml: string
  needsBaseUrl?: boolean
}

const ttsProviders: TtsDef[] = [
  {
    id: 'openai',
    name: 'OpenAI',
    url: 'api.openai.com',
    logoClass: 'openai-logo',
    keyPlaceholder: 'sk-...',
    hintHtml: 'TTS-1 / TTS-1-hd models with 11 voices. Get a key at <a href="https://platform.openai.com" target="_blank" rel="noopener">platform.openai.com</a>.',
  },
  {
    id: 'elevenlabs',
    name: 'ElevenLabs',
    url: 'api.elevenlabs.io',
    logoClass: 'elevenlabs-logo',
    keyPlaceholder: '...',
    hintHtml: 'Premium neural voices with cloning. Get a key at <a href="https://elevenlabs.io" target="_blank" rel="noopener">elevenlabs.io</a>.',
  },
  {
    id: 'deepgram',
    name: 'Deepgram Aura',
    url: 'api.deepgram.com',
    logoClass: 'deepgram-logo',
    keyPlaceholder: 'dg...',
    hintHtml: 'Aura-1 TTS model. Get a key at <a href="https://console.deepgram.com/signup" target="_blank" rel="noopener">console.deepgram.com</a>.',
  },
  {
    id: 'google',
    name: 'Google Cloud',
    url: 'texttospeech.googleapis.com',
    logoClass: 'google-logo',
    keyPlaceholder: 'AIza...',
    hintHtml: 'Cloud Text-to-Speech with WaveNet voices. Get a key at <a href="https://console.cloud.google.com/apis/credentials" target="_blank" rel="noopener">console.cloud.google.com</a>.',
  },
  {
    id: 'azure',
    name: 'Azure Speech',
    url: 'cognitiveservices.azure.com',
    logoClass: 'azure-logo',
    keyPlaceholder: '...',
    hintHtml: 'Azure Neural TTS. Get a key at <a href="https://portal.azure.com" target="_blank" rel="noopener">portal.azure.com</a>.',
  },
  {
    id: 'custom',
    name: 'Custom (OpenAI-compatible)',
    url: 'custom endpoint',
    logoClass: 'custom-logo',
    keyPlaceholder: '...',
    needsBaseUrl: true,
    hintHtml: 'Any OpenAI-compatible text-to-speech endpoint.',
  },
]

// ── auto-test watchers ─────────────────────────────────────────────────────────

for (const prov of sttProviders) {
  watch(() => stt.value[prov.id].apiKey, apiKey => {
    s.resetSttStatus(prov.id)
    clearAutoTest(`stt-${prov.id}`)
    if (apiKey.trim())
      scheduleAutoTest(`stt-${prov.id}`, () => s.testSttProvider(prov.id))
  })
  watch(() => stt.value[prov.id].baseUrl, baseUrl => {
    if (prov.needsBaseUrl) {
      s.resetSttStatus(prov.id)
      clearAutoTest(`stt-${prov.id}`)
      if (baseUrl.trim())
        scheduleAutoTest(`stt-${prov.id}`, () => s.testSttProvider(prov.id))
    }
  })
}

for (const prov of ttsProviders) {
  watch(() => tts.value[prov.id].apiKey, apiKey => {
    s.resetTtsStatus(prov.id)
    clearAutoTest(`tts-${prov.id}`)
    if (apiKey.trim())
      scheduleAutoTest(`tts-${prov.id}`, () => s.testTtsProvider(prov.id))
  })
  watch(() => tts.value[prov.id].baseUrl, baseUrl => {
    if (prov.needsBaseUrl) {
      s.resetTtsStatus(prov.id)
      clearAutoTest(`tts-${prov.id}`)
      if (baseUrl.trim())
        scheduleAutoTest(`tts-${prov.id}`, () => s.testTtsProvider(prov.id))
    }
  })
}

function isSttTestDisabled(prov: SttDef): boolean {
  const cfg = stt.value[prov.id]
  if (cfg.status === 'testing')
    return true
  if (prov.needsBaseUrl && !cfg.baseUrl.trim())
    return true
  if (!prov.needsBaseUrl && !cfg.apiKey.trim())
    return true
  return false
}

function isTtsTestDisabled(prov: TtsDef): boolean {
  const cfg = tts.value[prov.id]
  if (cfg.status === 'testing')
    return true
  if (prov.needsBaseUrl && !cfg.baseUrl.trim())
    return true
  if (!prov.needsBaseUrl && !cfg.apiKey.trim())
    return true
  return false
}
</script>

<template>
  <div class="voice-providers">
    <!-- ── STT Section ──────────────────────────────────────────────────── -->
    <div class="section-heading">
      <Mic :size="16" :stroke-width="1.8" />
      <span>Speech-to-Text (STT)</span>
    </div>

    <div v-for="prov in sttProviders" :key="prov.id">
      <ProviderCard
        :name="prov.name"
        :url="prov.url"
        :status="stt[prov.id].status"
        :status-message="stt[prov.id].statusMessage"
        :logo-class="prov.logoClass"
      >
        <template #logo>
          <Mic :size="18" :stroke-width="1.5" />
        </template>
        <template #actions>
          <button
            class="custom-toggle"
            :class="{ 'custom-toggle--on': sttProvider === prov.id }"
            :aria-label="sttProvider === prov.id ? 'Active (click to deactivate)' : 'Inactive (click to activate)'"
            @click="sttProvider = prov.id"
          >
            <span class="custom-toggle-thumb" />
          </button>
        </template>
        <template #fields>
          <div class="field-group">
            <label :for="`stt-${prov.id}-key`" class="field-label">API Key</label>
            <div class="key-input-row">
              <input
                :id="`stt-${prov.id}-key`"
                v-model="stt[prov.id].apiKey"
                type="password"
                :placeholder="prov.keyPlaceholder"
                spellcheck="false"
                autocomplete="off"
                class="field-input"
              >
            </div>
            <span class="field-hint" v-html="prov.hintHtml" />
          </div>

          <div v-if="prov.needsBaseUrl" class="field-group">
            <label :for="`stt-${prov.id}-url`" class="field-label">Base URL</label>
            <div class="key-input-row">
              <input
                :id="`stt-${prov.id}-url`"
                v-model="stt[prov.id].baseUrl"
                type="text"
                placeholder="https://api.example.com/v1"
                spellcheck="false"
                autocomplete="off"
                class="field-input"
              >
            </div>
          </div>

          <div class="field-group">
            <label :for="`stt-${prov.id}-model`" class="field-label">Model</label>
            <input
              :id="`stt-${prov.id}-model`"
              v-model="stt[prov.id].model"
              type="text"
              placeholder="whisper-1"
              spellcheck="false"
              autocomplete="off"
              class="field-input"
            >
          </div>

          <div class="field-group">
            <label :for="`stt-${prov.id}-lang`" class="field-label">Language</label>
            <input
              :id="`stt-${prov.id}-lang`"
              v-model="stt[prov.id].language"
              type="text"
              placeholder="en"
              spellcheck="false"
              autocomplete="off"
              class="field-input"
            >
          </div>
        </template>
        <template #footer>
          <button
            class="test-btn"
            :disabled="isSttTestDisabled(prov)"
            @click="s.testSttProvider(prov.id)"
          >
            <Loader v-if="stt[prov.id].status === 'testing'" :size="14" class="spin" />
            <Zap v-else :size="14" :stroke-width="2" />
            Test Connection
          </button>
        </template>
      </ProviderCard>
    </div>

    <!-- ── TTS Section ──────────────────────────────────────────────────── -->
    <div class="section-heading section-heading--gap">
      <Volume2 :size="16" :stroke-width="1.8" />
      <span>Text-to-Speech (TTS)</span>
    </div>

    <div v-for="prov in ttsProviders" :key="prov.id">
      <ProviderCard
        :name="prov.name"
        :url="prov.url"
        :status="tts[prov.id].status"
        :status-message="tts[prov.id].statusMessage"
        :logo-class="prov.logoClass"
      >
        <template #logo>
          <Volume2 :size="18" :stroke-width="1.5" />
        </template>
        <template #actions>
          <button
            class="custom-toggle"
            :class="{ 'custom-toggle--on': ttsProvider === prov.id }"
            :aria-label="ttsProvider === prov.id ? 'Active (click to deactivate)' : 'Inactive (click to activate)'"
            @click="ttsProvider = prov.id"
          >
            <span class="custom-toggle-thumb" />
          </button>
        </template>
        <template #fields>
          <div class="field-group">
            <label :for="`tts-${prov.id}-key`" class="field-label">API Key</label>
            <div class="key-input-row">
              <input
                :id="`tts-${prov.id}-key`"
                v-model="tts[prov.id].apiKey"
                type="password"
                :placeholder="prov.keyPlaceholder"
                spellcheck="false"
                autocomplete="off"
                class="field-input"
              >
            </div>
            <span class="field-hint" v-html="prov.hintHtml" />
          </div>

          <div v-if="prov.needsBaseUrl" class="field-group">
            <label :for="`tts-${prov.id}-url`" class="field-label">Base URL</label>
            <div class="key-input-row">
              <input
                :id="`tts-${prov.id}-url`"
                v-model="tts[prov.id].baseUrl"
                type="text"
                placeholder="https://api.example.com/v1"
                spellcheck="false"
                autocomplete="off"
                class="field-input"
              >
            </div>
          </div>

          <div class="field-group">
            <label :for="`tts-${prov.id}-model`" class="field-label">Model</label>
            <input
              :id="`tts-${prov.id}-model`"
              v-model="tts[prov.id].model"
              type="text"
              placeholder="tts-1"
              spellcheck="false"
              autocomplete="off"
              class="field-input"
            >
          </div>

          <div class="field-group">
            <label :for="`tts-${prov.id}-voice`" class="field-label">Voice</label>
            <input
              :id="`tts-${prov.id}-voice`"
              v-model="tts[prov.id].voice"
              type="text"
              placeholder="alloy"
              spellcheck="false"
              autocomplete="off"
              class="field-input"
            >
          </div>

          <div class="field-group">
            <label :for="`tts-${prov.id}-speed`" class="field-label">Speed</label>
            <input
              :id="`tts-${prov.id}-speed`"
              v-model.number="tts[prov.id].speed"
              type="range"
              min="0.25"
              max="4"
              step="0.25"
              class="speed-slider"
            >
            <span class="speed-value">{{ tts[prov.id].speed }}x</span>
          </div>
        </template>
        <template #footer>
          <button
            class="test-btn"
            :disabled="isTtsTestDisabled(prov)"
            @click="s.testTtsProvider(prov.id)"
          >
            <Loader v-if="tts[prov.id].status === 'testing'" :size="14" class="spin" />
            <Zap v-else :size="14" :stroke-width="2" />
            Test Connection
          </button>
        </template>
      </ProviderCard>
    </div>

    <!-- ── Post-Processing Section ──────────────────────────────────────────── -->
    <div class="processing-card">
      <div class="settings-card-header">
        <h3 class="settings-card-title">
          Post-Processing
        </h3>
      </div>
      <div class="processing-row">
        <div class="processing-info">
          <span class="processing-label">Remove filler words</span>
          <span class="processing-hint">Strips "um", "uh", stutters, false starts</span>
        </div>
        <button
          class="custom-toggle"
          :class="{ 'custom-toggle--on': voiceProcessing.removeFillers }"
          :aria-label="voiceProcessing.removeFillers ? 'Disable filler removal' : 'Enable filler removal'"
          @click="voiceProcessing.removeFillers = !voiceProcessing.removeFillers"
        >
          <span class="custom-toggle-thumb" />
        </button>
      </div>

      <div class="processing-row">
        <div class="processing-info">
          <span class="processing-label">Auto punctuation</span>
          <span class="processing-hint">Adds periods and question marks from speech patterns</span>
        </div>
        <button
          class="custom-toggle"
          :class="{ 'custom-toggle--on': voiceProcessing.autoPunctuate }"
          :aria-label="voiceProcessing.autoPunctuate ? 'Disable auto punctuation' : 'Enable auto punctuation'"
          @click="voiceProcessing.autoPunctuate = !voiceProcessing.autoPunctuate"
        >
          <span class="custom-toggle-thumb" />
        </button>
      </div>

      <div class="processing-row">
        <div class="processing-info">
          <span class="processing-label">Self-correction recognition</span>
          <span class="processing-hint">Detects backtracks like "actually X" and keeps the correction</span>
        </div>
        <button
          class="custom-toggle"
          :class="{ 'custom-toggle--on': voiceProcessing.correctBacktracks }"
          :aria-label="voiceProcessing.correctBacktracks ? 'Disable backtrack correction' : 'Enable backtrack correction'"
          @click="voiceProcessing.correctBacktracks = !voiceProcessing.correctBacktracks"
        >
          <span class="custom-toggle-thumb" />
        </button>
      </div>
    </div>

    <!-- ── Personal Dictionary Section ──────────────────────────────────────── -->
    <div class="processing-card">
      <div class="settings-card-header">
        <h3 class="settings-card-title">
          Personal Dictionary
        </h3>
      </div>
      <div v-if="voiceDictionary.length === 0" class="processing-row">
        <span class="processing-hint">Add words the STT mishears. Each entry replaces the wrong word with the correct one.</span>
      </div>
      <div v-for="(entry, i) in voiceDictionary" :key="i" class="processing-row">
        <div class="dict-fields">
          <input
            v-model="entry.wrong"
            class="dict-input dict-input--wrong"
            placeholder="Wrong word"
            spellcheck="false"
          >
          <span class="dict-arrow">→</span>
          <input
            v-model="entry.correct"
            class="dict-input dict-input--correct"
            placeholder="Correct word"
            spellcheck="false"
          >
        </div>
        <button class="dict-remove" @click="removeDictionaryEntry(i)">
          <X :size="14" />
        </button>
      </div>
      <button class="dict-add" @click="addDictionaryEntry">
        <Plus :size="14" />
        <span>Add entry</span>
      </button>
    </div>

    <!-- ── Voice Snippets Section ──────────────────────────────────────────── -->
    <div class="processing-card">
      <div class="settings-card-header">
        <h3 class="settings-card-title">
          Voice Snippets
        </h3>
      </div>
      <div v-if="voiceSnippets.length === 0" class="processing-row">
        <span class="processing-hint">Say a trigger word and it will be expanded into the full text.</span>
      </div>
      <div v-for="(snippet, i) in voiceSnippets" :key="i" class="processing-row snippet-row">
        <div class="snippet-fields">
          <input
            v-model="snippet.trigger"
            class="dict-input dict-input--wrong"
            placeholder="Trigger word"
            spellcheck="false"
          >
          <span class="dict-arrow">→</span>
          <input
            v-model="snippet.expansion"
            class="dict-input dict-input--correct"
            placeholder="Expanded text"
            spellcheck="false"
          >
        </div>
        <button class="dict-remove" @click="removeSnippet(i)">
          <X :size="14" />
        </button>
      </div>
      <button class="dict-add" @click="addSnippet">
        <Plus :size="14" />
        <span>Add snippet</span>
      </button>
    </div>
  </div>
</template>

<style scoped>
.voice-providers {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.section-heading {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13.5px;
  font-weight: 600;
  color: var(--color-text-secondary);
  padding: 4px 0;
}

.section-heading--gap {
  margin-top: 8px;
}

.field-group {
  display: flex;
  flex-direction: column;
}

.field-label {
  display: block;
  font-size: 13px;
  font-weight: 500;
  color: var(--color-text-secondary);
  margin-bottom: 6px;
}

.key-input-row {
  display: flex;
  gap: 8px;
  align-items: center;
}

.field-input {
  flex: 1;
  height: 34px;
  padding: 0 12px;
  border: 1px solid var(--color-border-mid);
  border-radius: var(--radius-md);
  background: var(--color-bg-card);
  color: var(--color-text-primary);
  font-family: inherit;
  font-size: 13px;
  outline: none;
  transition: all 150ms ease;
  box-shadow: inset 0 1px 2px color-mix(in srgb, var(--color-bg-base) 2%, transparent);
}

.field-input:focus {
  border-color: var(--color-accent);
  box-shadow: 0 0 0 2px color-mix(in srgb, var(--color-accent) 20%, transparent);
}

.field-input::placeholder {
  color: var(--color-text-tertiary);
}

.field-hint {
  display: block;
  font-size: 12.5px;
  color: var(--color-text-tertiary);
  margin-top: 6px;
  line-height: 1.5;
}

.field-hint :deep(a) {
  color: var(--color-accent);
  text-decoration: none;
}

.field-hint :deep(a:hover) {
  text-decoration: underline;
}

.custom-toggle {
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
  padding: 0;
  flex-shrink: 0;
}

.custom-toggle--on {
  background: var(--color-toggle-track-on);
  border-color: var(--color-accent);
}

.custom-toggle-thumb {
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

.custom-toggle--on .custom-toggle-thumb {
  transform: translateX(14px);
  background: var(--color-text-primary);
}

.test-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 32px;
  padding: 0 14px;
  border: 1px solid var(--color-border-mid);
  border-radius: var(--radius-md);
  background: var(--color-bg-elevated);
  color: var(--color-text-primary);
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  transition: all 150ms ease;
}

.test-btn:hover:not(:disabled) {
  background: var(--color-state-hover);
  border-color: var(--color-border-strong);
}

.test-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.speed-slider {
  width: 100%;
  height: 34px;
}

.speed-value {
  font-size: 12.5px;
  color: var(--color-text-tertiary);
  font-family: var(--font-mono);
  margin-top: 2px;
}

.processing-card {
  background: var(--color-bg-surface);
  border: 1px solid var(--color-border-subtle);
  border-radius: var(--radius-lg);
  overflow: hidden;
}

.settings-card-header {
  padding: 16px 20px 12px;
  border-bottom: 1px solid var(--color-border-subtle);
}

.settings-card-title {
  margin: 0;
  font-size: 13px;
  font-weight: 600;
  color: var(--color-text-secondary);
  letter-spacing: 0.01em;
}

.processing-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 20px;
  gap: 16px;
  border-bottom: 1px solid var(--color-border-subtle);
}

.processing-row:last-child {
  border-bottom: none;
}

.processing-info {
  display: flex;
  flex-direction: column;
  gap: 3px;
  flex: 1;
  min-width: 0;
}

.processing-label {
  font-size: 13.5px;
  font-weight: 500;
  color: var(--color-text-primary);
  line-height: 1.3;
}

.processing-hint {
  font-size: 12px;
  color: var(--color-text-tertiary);
  line-height: 1.4;
}

.dict-fields,
.snippet-fields {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: 1;
}

.dict-input {
  flex: 1;
  height: 30px;
  padding: 0 8px;
  border: 1px solid var(--color-border-mid);
  border-radius: var(--radius-sm);
  background: var(--color-bg-elevated);
  color: var(--color-text-primary);
  font-size: 12.5px;
  font-family: var(--font-mono);
  outline: none;
  transition: border-color 150ms ease;
}

.dict-input:focus {
  border-color: var(--color-accent);
}

.dict-input--wrong {
  color: var(--color-danger-text);
}

.dict-input--correct {
  color: var(--color-success-text);
}

.dict-arrow {
  color: var(--color-text-tertiary);
  font-size: 14px;
  flex-shrink: 0;
}

.dict-remove {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  border: none;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--color-text-tertiary);
  cursor: pointer;
  transition: all 120ms ease;
  flex-shrink: 0;
}

.dict-remove:hover {
  background: var(--color-state-hover);
  color: var(--color-danger-text);
}

.dict-add {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  padding: 10px 20px;
  border: none;
  background: transparent;
  color: var(--color-accent-text);
  font-size: 12.5px;
  font-weight: 500;
  cursor: pointer;
  transition: background 120ms ease;
}

.dict-add:hover {
  background: var(--color-state-hover);
}

.spin {
  animation: spin 1s linear infinite;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}
</style>
