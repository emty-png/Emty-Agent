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
  <div :class="screenClasses" role="dialog" aria-modal="true" aria-label="Fatal error">
    <div :class="contentClasses">
      <div :class="headerClasses">
        <h1 :class="titleClasses">
          Something went wrong
        </h1>
        <p :class="subtitleClasses">
          An error occurred while loading the application.
        </p>
      </div>

      <div :class="boxClasses">
        <pre :class="codeClasses"><code><span :class="errorNameClasses">{{ error.name }}: </span>{{ error.message }}<br>{{ error.stack }}</code></pre>
      </div>

      <div :class="actionsClasses">
        <button :class="btnSecondaryClasses" @click="handleRestart">
          Restart
        </button>
        <button :class="btnPrimaryClasses" @click="copyDebug">
          {{ copied ? 'Copied' : 'Copy debug' }}
        </button>
      </div>

      <div :class="footerClasses">
        <p :class="contactClasses">
          Please report this error on github
          <a :class="linkClasses" href="https://github.com/emty-png/Emty-Agent" target="_blank" rel="noopener noreferrer">
            GitHub
            <svg class="align-middle" viewBox="0 0 24 24" width="13" height="13" fill="currentColor">
              <path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12" />
            </svg>
          </a>
        </p>
        <p :class="versionClasses">
          Version: v0.1.0
        </p>
      </div>
    </div>
  </div>
</template>
