<script setup lang="ts">
import { relaunch } from '@tauri-apps/plugin-process'
import { check } from '@tauri-apps/plugin-updater'
import { RefreshCw, Volume2, VolumeX } from 'lucide-vue-next'
import { storeToRefs } from 'pinia'
import { ref } from 'vue'
import { useSettingsStore } from '@/stores/settings'

const settingsStore = useSettingsStore()
const { sound } = storeToRefs(settingsStore)

function testCompletion() {
  import('@/utils/sounds').then(({ playCompletionSound }) => playCompletionSound(sound.value.volume)).catch(() => {})
}

function testError() {
  import('@/utils/sounds').then(({ playErrorSound }) => playErrorSound(sound.value.volume)).catch(() => {})
}

const isCheckingUpdate = ref(false)
const updateStatus = ref('')
const hasUpdate = ref(false)

async function checkForUpdate() {
  if (isCheckingUpdate.value)
    return
  isCheckingUpdate.value = true
  updateStatus.value = 'Checking for updates...'

  try {
    const update = await check()
    if (update) {
      hasUpdate.value = true
      updateStatus.value = `Update ${update.version} available. Downloading...`
      await update.downloadAndInstall(event => {
        if (event.event === 'Finished') {
          updateStatus.value = 'Download finished. Restarting...'
        }
      })
      await relaunch()
    }
    else {
      updateStatus.value = 'You are on the latest version.'
      hasUpdate.value = false
    }
  }
  catch (error) {
    updateStatus.value = 'Error checking for updates'
    console.error(error)
  }
  finally {
    isCheckingUpdate.value = false
  }
}
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
              :disabled="isCheckingUpdate || hasUpdate"
              title="Check for updates"
              @click.prevent="checkForUpdate"
            >
              <RefreshCw v-if="!hasUpdate" :size="12" :class="{ 'animate-spin': isCheckingUpdate }" />
              <span>{{ isCheckingUpdate ? 'Checking...' : (hasUpdate ? 'Downloading...' : 'Check') }}</span>
            </button>
          </div>
        </div>
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
</style>
