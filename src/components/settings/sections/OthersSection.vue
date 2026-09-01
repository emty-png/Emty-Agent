<script setup lang="ts">
import { getVersion } from '@tauri-apps/api/app'
import { Trash2, Upload, Volume2, VolumeX } from 'lucide-vue-next'
import { storeToRefs } from 'pinia'
import { onMounted, ref } from 'vue'
import { useUpdateCheck } from '@/composables/app/useUpdateCheck'
import { useSettingsStore } from '@/stores/settings'

const settingsStore = useSettingsStore()
const { sound, developerMode } = storeToRefs(settingsStore)
const {
  isCheckingUpdate,
  isDownloadingUpdate,
  updateStatus,
  hasUpdate,
  showUpdateConfirm,
  pendingUpdate,
  cancelUpdate,
  handleUpdateButtonClick,
  confirmUpdate,
} = useUpdateCheck()

function testCompletion() {
  import('@/utils/sounds').then(({ playCompletionSound }) => playCompletionSound(sound.value.volume, sound.value.completionCustomData ?? undefined)).catch(() => {})
}

function testError() {
  import('@/utils/sounds').then(({ playErrorSound }) => playErrorSound(sound.value.volume, sound.value.errorCustomData ?? undefined)).catch(() => {})
}

const completionInputRef = ref<HTMLInputElement | null>(null)
const errorInputRef = ref<HTMLInputElement | null>(null)
const completionError = ref('')
const errorSoundError = ref('')

const MAX_SOUND_SIZE = 2 * 1024 * 1024 // 2 MB — keeps base64 (~2.7 MB) under localStorage limits

function triggerCompletionUpload() {
  completionError.value = ''
  completionInputRef.value?.click()
}

function triggerErrorUpload() {
  errorSoundError.value = ''
  errorInputRef.value?.click()
}

function isAudioFile(file: File): boolean {
  if (file.type.startsWith('audio/'))
    return true
  return /\.(?:mp3|wav|ogg|m4a|flac|webm|aac|aiff|wma)$/i.test(file.name)
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = () => reject(new Error('Failed to read file'))
    reader.readAsDataURL(file)
  })
}

async function onCompletionFileChange(e: Event) {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file)
    return
  if (!isAudioFile(file)) {
    completionError.value = 'Please select an audio file (mp3, wav, ogg, m4a, flac, webm).'
    return
  }
  if (file.size > MAX_SOUND_SIZE) {
    completionError.value = `File too large — max 2 MB (got ${(file.size / 1024 / 1024).toFixed(2)} MB).`
    return
  }
  try {
    const dataUrl = await readFileAsDataUrl(file)
    sound.value.completionCustomData = dataUrl
    sound.value.completionCustomName = file.name
    completionError.value = ''
  }
  catch (err) {
    completionError.value = err instanceof Error ? err.message : 'Failed to load audio file'
  }
}

async function onErrorFileChange(e: Event) {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file)
    return
  if (!isAudioFile(file)) {
    errorSoundError.value = 'Please select an audio file (mp3, wav, ogg, m4a, flac, webm).'
    return
  }
  if (file.size > MAX_SOUND_SIZE) {
    errorSoundError.value = `File too large — max 2 MB (got ${(file.size / 1024 / 1024).toFixed(2)} MB).`
    return
  }
  try {
    const dataUrl = await readFileAsDataUrl(file)
    sound.value.errorCustomData = dataUrl
    sound.value.errorCustomName = file.name
    errorSoundError.value = ''
  }
  catch (err) {
    errorSoundError.value = err instanceof Error ? err.message : 'Failed to load audio file'
  }
}

function resetCompletionSound() {
  sound.value.completionCustomData = null
  sound.value.completionCustomName = null
  completionError.value = ''
}

function resetErrorSound() {
  sound.value.errorCustomData = null
  sound.value.errorCustomName = null
  errorSoundError.value = ''
}

const appVersion = ref('')

onMounted(async () => {
  try {
    appVersion.value = await getVersion()
  }
  catch {
    // ignore — not in Tauri env or unavailable
  }
})
</script>

<template>
  <section class="content-section">
    <!-- Header -->
    <header class="section-head">
      <h2 class="section-title">
        Others
      </h2>
    </header>

    <!-- Sound Effects Card -->
    <div class="settings-card">
      <div class="settings-card-header">
        <h3 class="settings-card-title">
          Sound Effects
        </h3>
      </div>

      <div class="settings-list">
        <!-- Completion sound toggle -->
        <label class="settings-item">
          <div class="settings-item-content">
            <span class="settings-item-label">Completion sound</span>
            <span class="settings-item-desc">Play a chime when the agent finishes responding</span>
          </div>
          <div class="toggle-row">
            <button
              class="ghost-btn"
              type="button"
              :disabled="!sound.completionEnabled"
              title="Preview completion sound"
              @click.prevent="testCompletion"
            >
              <Volume2 :size="12" />
              <span>Test</span>
            </button>
            <button
              class="model-toggle"
              :class="{ 'model-toggle--on': sound.completionEnabled }"
              type="button"
              :aria-pressed="sound.completionEnabled"
              @click="sound.completionEnabled = !sound.completionEnabled"
            >
              <span class="model-toggle-thumb" />
            </button>
          </div>
        </label>

        <!-- Completion custom sound -->
        <div class="settings-item settings-item--field">
          <div class="settings-item-content">
            <span class="settings-item-label">Custom completion sound</span>
            <span class="settings-item-desc">{{ sound.completionCustomName ? sound.completionCustomName : 'No custom sound — using default chime (mp3, wav, ogg, m4a, max 2MB)' }}</span>
            <span v-if="completionError" class="field-error">{{ completionError }}</span>
          </div>
          <div class="toggle-row">
            <input
              ref="completionInputRef"
              type="file"
              accept="audio/*,.mp3,.wav,.ogg,.m4a,.flac,.webm,.aac"
              class="hidden-file-input"
              @change="onCompletionFileChange"
            >
            <button class="ghost-btn" type="button" @click="triggerCompletionUpload">
              <Upload :size="12" />
              <span>{{ sound.completionCustomData ? 'Change' : 'Upload' }}</span>
            </button>
            <button
              v-if="sound.completionCustomData"
              class="ghost-btn ghost-btn--danger"
              type="button"
              title="Reset to default chime"
              @click="resetCompletionSound"
            >
              <Trash2 :size="12" />
              <span>Reset</span>
            </button>
          </div>
        </div>

        <!-- Error sound toggle -->
        <label class="settings-item">
          <div class="settings-item-content">
            <span class="settings-item-label">Error sound</span>
            <span class="settings-item-desc">Play a tone when streaming fails or errors out</span>
          </div>
          <div class="toggle-row">
            <button
              class="ghost-btn"
              type="button"
              :disabled="!sound.errorEnabled"
              title="Preview error sound"
              @click.prevent="testError"
            >
              <VolumeX :size="12" />
              <span>Test</span>
            </button>
            <button
              class="model-toggle"
              :class="{ 'model-toggle--on': sound.errorEnabled }"
              type="button"
              :aria-pressed="sound.errorEnabled"
              @click="sound.errorEnabled = !sound.errorEnabled"
            >
              <span class="model-toggle-thumb" />
            </button>
          </div>
        </label>

        <!-- Error custom sound -->
        <div class="settings-item settings-item--field">
          <div class="settings-item-content">
            <span class="settings-item-label">Custom error sound</span>
            <span class="settings-item-desc">{{ sound.errorCustomName ? sound.errorCustomName : 'No custom sound — using default tone (mp3, wav, ogg, m4a, max 2MB)' }}</span>
            <span v-if="errorSoundError" class="field-error">{{ errorSoundError }}</span>
          </div>
          <div class="toggle-row">
            <input
              ref="errorInputRef"
              type="file"
              accept="audio/*,.mp3,.wav,.ogg,.m4a,.flac,.webm,.aac"
              class="hidden-file-input"
              @change="onErrorFileChange"
            >
            <button class="ghost-btn" type="button" @click="triggerErrorUpload">
              <Upload :size="12" />
              <span>{{ sound.errorCustomData ? 'Change' : 'Upload' }}</span>
            </button>
            <button
              v-if="sound.errorCustomData"
              class="ghost-btn ghost-btn--danger"
              type="button"
              title="Reset to default tone"
              @click="resetErrorSound"
            >
              <Trash2 :size="12" />
              <span>Reset</span>
            </button>
          </div>
        </div>

        <!-- Volume slider -->
        <div class="settings-item settings-item--field">
          <div class="settings-item-content">
            <span class="settings-item-label">Volume</span>
            <span class="settings-item-desc">Applies to both sound effects</span>
          </div>
          <div class="range-field">
            <input
              v-model.number="sound.volume"
              type="range"
              min="0"
              max="100"
              step="5"
              class="range-input"
              aria-label="Sound effect volume"
            >
            <span class="range-value">{{ sound.volume }}%</span>
          </div>
        </div>
      </div>
    </div>

    <!-- Update Card -->
    <div class="settings-card">
      <div class="settings-card-header">
        <h3 class="settings-card-title">
          Updates
        </h3>
        <span v-if="appVersion" class="settings-card-version">v{{ appVersion }}</span>
      </div>
      <div class="settings-list">
        <div class="settings-item">
          <div class="settings-item-content">
            <span class="settings-item-label">Check for Updates</span>
            <span class="settings-item-desc">{{ updateStatus || 'Check for new versions of the app manually' }}</span>
          </div>
          <div class="toggle-row">
            <button
              class="ghost-btn"
              type="button"
              :disabled="isCheckingUpdate || isDownloadingUpdate"
              :title="hasUpdate ? 'Download update' : 'Check for updates'"
              @click.prevent="handleUpdateButtonClick"
            >
              <span>{{ isCheckingUpdate ? 'Checking...' : (isDownloadingUpdate ? 'Downloading...' : (hasUpdate ? 'Download' : 'Check')) }}</span>
            </button>
          </div>
        </div>
      </div>
    </div>

    <!-- Developer Mode Card -->
    <div class="settings-card">
      <div class="settings-card-header">
        <h3 class="settings-card-title">
          Developer
        </h3>
      </div>
      <div class="settings-list">
        <label class="settings-item">
          <div class="settings-item-content">
            <span class="settings-item-label">Developer Mode</span>
            <span class="settings-item-desc">Unlock advanced options for customizing and extending the app</span>
          </div>
          <button
            class="model-toggle"
            :class="{ 'model-toggle--on': developerMode }"
            type="button"
            :aria-pressed="developerMode"
            @click="developerMode = !developerMode"
          >
            <span class="model-toggle-thumb" />
          </button>
        </label>
      </div>
    </div>
  </section>
</template>

<style scoped>
/* =========================================
   Section Shell
 ========================================= */
.content-section {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.section-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 4px;
}

.section-title {
  margin: 0 0 4px 0;
  font-size: 18px;
  font-weight: 600;
  color: var(--color-text-primary);
  letter-spacing: -0.01em;
}

/* =========================================
   Settings Card
 ========================================= */
.settings-card {
  border: 1px solid var(--color-border-subtle);
  border-radius: var(--radius-lg);
  overflow: hidden;
  background: var(--color-bg-surface);
}

.settings-card-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
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

.settings-card-version {
  font-size: 12px;
  font-weight: 500;
  color: var(--color-text-tertiary);
  letter-spacing: 0.02em;
  flex-shrink: 0;
}

/* =========================================
   Settings List & Items
 ========================================= */
.settings-list {
  display: flex;
  flex-direction: column;
}

.settings-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 14px 20px;
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
  gap: 3px;
  flex: 1;
  min-width: 0;
}

.settings-item-label {
  font-size: 13.5px;
  font-weight: 500;
  color: var(--color-text-primary);
  line-height: 1.3;
}

.settings-item-desc {
  font-size: 12px;
  color: var(--color-text-tertiary);
  line-height: 1.4;
}

/* =========================================
   Toggle row (test button + switch)
 ========================================= */
.toggle-row {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-shrink: 0;
}

/* =========================================
   Ghost Action Button
 ========================================= */
.ghost-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 32px;
  padding: 0 12px;
  border: 1px solid var(--color-border-mid);
  border-radius: var(--radius-md);
  background: transparent;
  color: var(--color-text-secondary);
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.15s ease;
  white-space: nowrap;
}

.ghost-btn:hover:not(:disabled) {
  background: var(--color-state-hover);
  color: var(--color-text-primary);
  border-color: var(--color-text-tertiary);
}

.ghost-btn:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

/* =========================================
   Toggle Switch
 ========================================= */
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

/* =========================================
   Volume Slider
 ========================================= */
.range-field {
  display: flex;
  align-items: center;
  gap: 12px;
  min-width: 180px;
}

.range-input {
  width: 140px;
  accent-color: var(--color-accent);
}

.range-value {
  min-width: 40px;
  text-align: right;
  font-size: 12px;
  font-weight: 600;
  color: var(--color-text-secondary);
}

.hidden-file-input {
  display: none;
}

.field-error {
  margin-top: 4px;
  font-size: 11.5px;
  font-weight: 500;
  color: var(--color-danger-text, #ef4444);
  line-height: 1.4;
}

.ghost-btn--danger {
  color: var(--color-danger-text, #ef4444);
  border-color: color-mix(in srgb, var(--color-danger, #ef4444) 30%, transparent);
}

.ghost-btn--danger:hover:not(:disabled) {
  background: color-mix(in srgb, var(--color-danger, #ef4444) 10%, transparent);
  border-color: color-mix(in srgb, var(--color-danger, #ef4444) 45%, transparent);
  color: var(--color-danger-text, #ef4444);
}
</style>
