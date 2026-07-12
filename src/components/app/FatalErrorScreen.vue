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

// ── Tailwind Class Extractions ──────────────────────────────────────────────
const screenClasses = 'fixed inset-0 bg-(--color-bg-base) text-(--color-text-primary) flex items-center justify-center font-[inherit] z-[9999] select-none'
const contentClasses = 'w-full max-w-[760px] py-12 px-6 flex flex-col items-center text-center'

const headerClasses = 'mb-7 flex flex-col items-center gap-2.5'
const titleClasses = 'text-[17px] font-semibold m-0 text-(--color-text-primary) tracking-[0.01em]'
const subtitleClasses = 'text-[13px] text-(--color-text-tertiary) m-0'

const boxClasses = 'w-full bg-(--color-bg-surface) border border-(--color-border-mid) rounded-(--radius-md) py-4 px-5 mb-7 text-left overflow-hidden'
const codeClasses = 'm-0 font-mono text-[12.5px] leading-[1.65] text-(--color-text-secondary) whitespace-pre-wrap break-all select-text'
const errorNameClasses = 'text-(--color-danger-text) font-semibold'

const actionsClasses = 'flex gap-2.5 mb-11'
const btnBase = 'py-[7px] px-[22px] border rounded-(--radius-sm) text-[13px] font-medium cursor-pointer tracking-[0.01em] transition-colors duration-150 border-transparent'
const btnSecondaryClasses = `${btnBase} bg-(--color-bg-elevated) border-(--color-border-bright) text-(--color-text-secondary) hover:bg-(--color-bg-hover) hover:border-(--color-text-dim) hover:text-(--color-text-primary)`
const btnPrimaryClasses = `${btnBase} bg-(--color-accent-muted-plus) border-(--color-accent-dim) text-(--color-accent-text) hover:bg-(--color-accent-muted) hover:border-(--color-accent) hover:text-(--color-accent-bright)`

const footerClasses = 'text-[13px] flex flex-col items-center gap-1.5'
const contactClasses = 'text-(--color-text-tertiary) m-0'
const linkClasses = 'text-(--color-accent-text) font-medium inline-flex items-center gap-[3px] cursor-pointer transition-colors duration-150 hover:text-(--color-accent-bright)'
const versionClasses = 'text-(--color-text-dim) text-[11.5px] m-0'
</script>

<template>
  <div :class="screenClasses">
    <div :class="contentClasses">
      <!-- Header -->
      <div :class="headerClasses">
        <h1 :class="titleClasses">
          Something went wrong
        </h1>
        <p :class="subtitleClasses">
          An error occurred while loading the application.
        </p>
      </div>

      <!-- Error Box -->
      <div :class="boxClasses">
        <pre :class="codeClasses"><code><span :class="errorNameClasses">{{ error.name }}: </span>{{ error.message }}<br>{{ error.stack }}</code></pre>
      </div>

      <!-- Actions -->
      <div :class="actionsClasses">
        <button :class="btnSecondaryClasses" @click="handleRestart">
          Restart
        </button>
        <button :class="btnPrimaryClasses" @click="copyDebug">
          {{ copied ? 'Copied' : 'Copy debug' }}
        </button>
      </div>

      <!-- Footer -->
      <div :class="footerClasses">
        <p :class="contactClasses">
          Please report this error to the OpenCode team on
          <span :class="linkClasses">
            Discord
            <svg class="align-middle" viewBox="0 0 24 24" width="13" height="13" fill="currentColor">
              <path d="M20.317 4.3698a19.7913 19.7913 0 00-4.8851-1.5152.0741.0741 0 00-.0785.0371c-.211.3753-.4447.8648-.6083 1.2495-1.8447-.2762-3.68-.2762-5.4868 0-.1636-.3933-.4058-.8742-.6177-1.2495a.077.077 0 00-.0785-.037 19.7363 19.7363 0 00-4.8852 1.515.0699.0699 0 00-.0321.0277C.5334 9.0458-.319 13.5799.0992 18.0578a.0824.0824 0 00.0312.0561c2.0528 1.5076 4.0413 2.4228 5.9929 3.0294a.0777.0777 0 00.0842-.0276c.4616-.6304.8731-1.2952 1.226-1.9942a.076.076 0 00-.0416-.1057c-.6528-.2476-1.2743-.5495-1.8722-.8923a.077.077 0 01-.0076-.1277c.1258-.0943.2517-.1923.3718-.2914a.0743.0743 0 01.0776-.0105c3.9278 1.7933 8.18 1.7933 12.0614 0a.0739.0739 0 01.0785.0095c.1202.099.246.1981.3728.2924a.077.077 0 01-.0066.1276 12.2986 12.2986 0 01-1.873.8914.0766.0766 0 00-.0407.1067c.3604.698.7719 1.3628 1.225 1.9932a.076.076 0 00.0842.0286c1.961-.6067 3.9495-1.5219 6.0023-3.0294a.077.077 0 00.0313-.0552c.5004-5.177-.8382-9.6739-3.5485-13.6604a.061.061 0 00-.0312-.0286zM8.02 15.3312c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9555-2.4189 2.157-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419 0 1.3332-.9555 2.4189-2.1569 2.4189zm7.9748 0c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9554-2.4189 2.1569-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419 0 1.3332-.946 2.4189-2.1568 2.4189Z" />
            </svg>
          </span>
        </p>
        <p :class="versionClasses">
          Version: v0.1.0
        </p>
      </div>
    </div>
  </div>
</template>
