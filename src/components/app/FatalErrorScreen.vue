<script setup lang="ts">
import { ref } from 'vue'

const props = defineProps({
  error: {
    type: Object,
    default: () => ({
      name: 'TypeError',
      message: 'Failed to fetch',
      stack: '    at fetch (oc://renderer/assets/main-BU1Vfpmg.js:114666:45)\n    at request (oc://renderer/assets/main-BU1Vfpmg.js:71162:24)\n    at async oc://renderer/assets/dialog-connect-provider-Cxep4Fux.js:80:17',
    }),
  },
})

const copied = ref(false)

function handleRestart() {
  window.location.reload()
}

async function copyDebug() {
  try {
    const textToCopy = `${props.error.name}: ${props.error.message}\n${props.error.stack}`
    await navigator.clipboard.writeText(textToCopy)
    copied.value = true
    window.setTimeout(() => {
      copied.value = false
    }, 2000)
  }
  catch (err) {
    console.error('Failed to copy', err)
  }
}
</script>

<template>
  <div class="fatal-error-screen">
    <div class="fatal-content">
      <!-- Header -->
      <div class="fatal-header">
        <h1 class="fatal-title">
          Something went wrong
        </h1>
        <p class="fatal-subtitle">
          An error occurred while loading the application.
        </p>
      </div>

      <!-- Error Box -->
      <div class="fatal-box">
        <pre class="fatal-code"><code><span class="fatal-error-name">{{ error.name }}: </span>{{ error.message }}<br>{{ error.stack }}</code></pre>
      </div>

      <!-- Actions -->
      <div class="fatal-actions">
        <button class="fatal-btn fatal-btn--secondary" @click="handleRestart">
          Restart
        </button>
        <button class="fatal-btn fatal-btn--primary" @click="copyDebug">
          {{ copied ? 'Copied!' : 'Copy debug' }}
        </button>
      </div>

      <!-- Footer -->
      <div class="fatal-footer">
        <p class="footer-contact">
          Please report this error to the OpenCode team on
          <span class="discord-link">
            Discord
            <svg class="discord-icon" viewBox="0 0 24 24" width="13" height="13" fill="currentColor">
              <path d="M20.317 4.3698a19.7913 19.7913 0 00-4.8851-1.5152.0741.0741 0 00-.0785.0371c-.211.3753-.4447.8648-.6083 1.2495-1.8447-.2762-3.68-.2762-5.4868 0-.1636-.3933-.4058-.8742-.6177-1.2495a.077.077 0 00-.0785-.037 19.7363 19.7363 0 00-4.8852 1.515.0699.0699 0 00-.0321.0277C.5334 9.0458-.319 13.5799.0992 18.0578a.0824.0824 0 00.0312.0561c2.0528 1.5076 4.0413 2.4228 5.9929 3.0294a.0777.0777 0 00.0842-.0276c.4616-.6304.8731-1.2952 1.226-1.9942a.076.076 0 00-.0416-.1057c-.6528-.2476-1.2743-.5495-1.8722-.8923a.077.077 0 01-.0076-.1277c.1258-.0943.2517-.1923.3718-.2914a.0743.0743 0 01.0776-.0105c3.9278 1.7933 8.18 1.7933 12.0614 0a.0739.0739 0 01.0785.0095c.1202.099.246.1981.3728.2924a.077.077 0 01-.0066.1276 12.2986 12.2986 0 01-1.873.8914.0766.0766 0 00-.0407.1067c.3604.698.7719 1.3628 1.225 1.9932a.076.076 0 00.0842.0286c1.961-.6067 3.9495-1.5219 6.0023-3.0294a.077.077 0 00.0313-.0552c.5004-5.177-.8382-9.6739-3.5485-13.6604a.061.061 0 00-.0312-.0286zM8.02 15.3312c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9555-2.4189 2.157-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419 0 1.3332-.9555 2.4189-2.1569 2.4189zm7.9748 0c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9554-2.4189 2.1569-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419 0 1.3332-.946 2.4189-2.1568 2.4189Z" />
            </svg>
          </span>
        </p>
        <p class="version-tag">
          Version: v0.1.0
        </p>
      </div>
    </div>
  </div>
</template>

<style scoped>
.fatal-error-screen {
  position: fixed;
  inset: 0;
  background-color: var(--color-bg-base);
  color: var(--color-text-primary);
  display: flex;
  align-items: center;
  justify-content: center;
  font-family: inherit;
  z-index: 9999;
  user-select: none;
}

.fatal-content {
  width: 100%;
  max-width: 760px;
  padding: 48px 24px;
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
}

/* Header */
.fatal-header {
  margin-bottom: 28px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
}

.fatal-title {
  font-size: 17px;
  font-weight: 600;
  margin: 0;
  color: var(--color-text-primary);
  letter-spacing: 0.01em;
}

.fatal-subtitle {
  font-size: 13px;
  color: var(--color-text-tertiary);
  margin: 0;
}

/* Error box */
.fatal-box {
  width: 100%;
  background-color: var(--color-bg-surface);
  border: 1px solid var(--color-border-mid);
  border-radius: var(--radius-md);
  padding: 16px 20px;
  margin-bottom: 28px;
  text-align: left;
  overflow: hidden;
}

.fatal-code {
  margin: 0;
  font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
  font-size: 12.5px;
  line-height: 1.65;
  color: var(--color-text-secondary);
  white-space: pre-wrap;
  word-break: break-all;
  user-select: text;
}

.fatal-error-name {
  color: var(--color-danger-text);
  font-weight: 600;
}

/* Buttons */
.fatal-actions {
  display: flex;
  gap: 10px;
  margin-bottom: 44px;
}

.fatal-btn {
  padding: 7px 22px;
  border-radius: var(--radius-sm);
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  transition:
    background-color 0.15s ease,
    border-color 0.15s ease,
    color 0.15s ease;
  letter-spacing: 0.01em;
  border: 1px solid transparent;
}

/* Secondary — Restart */
.fatal-btn--secondary {
  background-color: var(--color-bg-elevated);
  border-color: var(--color-border-bright);
  color: var(--color-text-secondary);
}

.fatal-btn--secondary:hover {
  background-color: var(--color-bg-hover);
  border-color: var(--color-text-dim);
  color: var(--color-text-primary);
}

/* Primary — Copy debug */
.fatal-btn--primary {
  background-color: var(--color-accent-muted-plus);
  border-color: var(--color-accent-dim);
  color: var(--color-accent-text);
}

.fatal-btn--primary:hover {
  background-color: var(--color-accent-muted);
  border-color: var(--color-accent);
  color: var(--color-accent-bright);
}

/* Footer */
.fatal-footer {
  font-size: 13px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
}

.footer-contact {
  color: var(--color-text-tertiary);
  margin: 0;
}

.discord-link {
  color: var(--color-accent-text);
  font-weight: 500;
  display: inline-flex;
  align-items: center;
  gap: 3px;
  cursor: pointer;
  transition: color 0.15s ease;
}

.discord-link:hover {
  color: var(--color-accent-bright);
}

.discord-icon {
  vertical-align: middle;
}

.version-tag {
  color: var(--color-text-dim);
  font-size: 11.5px;
  margin: 0;
}

/* Animations */
@keyframes fatal-pulse {
  0%,
  100% {
    opacity: 1;
    box-shadow: 0 0 6px var(--color-danger);
  }
  50% {
    opacity: 0.4;
    box-shadow: 0 0 2px var(--color-danger);
  }
}
</style>
