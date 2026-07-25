<script setup lang="ts">
import { onMounted, onUnmounted } from 'vue'

const emit = defineEmits<{ next: [] }>()

function handleKeydown(e: KeyboardEvent) {
  if (e.key === 'Enter')
    emit('next')
}

onMounted(() => window.addEventListener('keydown', handleKeydown))
onUnmounted(() => window.removeEventListener('keydown', handleKeydown))
</script>

<template>
  <div class="welcome-root">
    <div class="grid-bg" aria-hidden="true" />

    <div class="canvas-frame">
      <span class="bracket bracket-tl" aria-hidden="true" />
      <span class="bracket bracket-tr" aria-hidden="true" />
      <span class="bracket bracket-bl" aria-hidden="true" />
      <span class="bracket bracket-br" aria-hidden="true" />

      <div class="content">
        <p class="eyebrow">
          <span class="eyebrow-chevron">›</span> new agent
        </p>

        <h1 class="title">
          <span class="title-text">Empty Agent</span><span class="cursor" aria-hidden="true" />
        </h1>

        <p class="description">
          No presets. No defaults. Just a blank canvas — and an agent
          waiting to become whatever you build.
        </p>

        <button class="cta" @click="emit('next')">
          <span>Get started</span>
          <svg class="cta-arrow" width="16" height="16" viewBox="0 0 16 16" fill="none">
            <path d="M3.5 8H12.5M12.5 8L8.5 4M12.5 8L8.5 12" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" />
          </svg>
        </button>

        <p class="hint">
          or press <kbd>Enter</kbd>
        </p>
      </div>
    </div>
  </div>
</template>

<style scoped>
@import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;700&display=swap');

.welcome-root {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  height: 100%;
  flex: 1;
  overflow: hidden;
  background: var(--color-bg-base);
}

/* Faint blueprint grid standing in for the old glow blob — this is the
   "blank canvas" the product name refers to, not decoration for its own sake. */
.grid-bg {
  position: absolute;
  inset: 0;
  background-image:
    linear-gradient(color-mix(in srgb, var(--color-border-mid) 55%, transparent) 1px, transparent 1px),
    linear-gradient(90deg, color-mix(in srgb, var(--color-border-mid) 55%, transparent) 1px, transparent 1px);
  background-size: 44px 44px;
  mask-image: radial-gradient(ellipse 55% 60% at 50% 46%, black 0%, transparent 78%);
  -webkit-mask-image: radial-gradient(ellipse 55% 60% at 50% 46%, black 0%, transparent 78%);
  opacity: 0;
  animation: grid-in 1.6s ease-out 0.1s forwards;
  pointer-events: none;
}

@keyframes grid-in {
  to {
    opacity: 1;
  }
}

.canvas-frame {
  position: relative;
  padding: 88px 128px;
  z-index: 1;
}

/* Corner brackets frame the content like an empty selection — a viewfinder
   waiting to lock onto something, echoing "empty" more directly than a glow. */
.bracket {
  position: absolute;
  width: 26px;
  height: 26px;
  opacity: 0;
  transform: scale(1.6);
}

.bracket-tl {
  top: 0;
  left: 0;
  border-top: 2px solid var(--color-border-mid);
  border-left: 2px solid var(--color-border-mid);
  transform-origin: top left;
  animation: bracket-in 0.5s cubic-bezier(0.16, 1, 0.3, 1) 0s forwards;
}

.bracket-tr {
  top: 0;
  right: 0;
  border-top: 2px solid var(--color-border-mid);
  border-right: 2px solid var(--color-border-mid);
  transform-origin: top right;
  animation: bracket-in 0.5s cubic-bezier(0.16, 1, 0.3, 1) 0.06s forwards;
}

.bracket-bl {
  bottom: 0;
  left: 0;
  border-bottom: 2px solid var(--color-border-mid);
  border-left: 2px solid var(--color-border-mid);
  transform-origin: bottom left;
  animation: bracket-in 0.5s cubic-bezier(0.16, 1, 0.3, 1) 0.12s forwards;
}

.bracket-br {
  bottom: 0;
  right: 0;
  border-bottom: 2px solid var(--color-border-mid);
  border-right: 2px solid var(--color-border-mid);
  transform-origin: bottom right;
  animation: bracket-in 0.5s cubic-bezier(0.16, 1, 0.3, 1) 0.18s forwards;
}

@keyframes bracket-in {
  to {
    opacity: 1;
    transform: scale(1);
  }
}

.content {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 20px;
}

.eyebrow {
  display: flex;
  align-items: center;
  gap: 6px;
  margin: 0;
  font-family: 'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 13px;
  font-weight: 500;
  letter-spacing: 0.01em;
  color: var(--color-text-secondary);
  opacity: 0;
  transform: translateY(8px);
  animation: fade-up 0.6s ease-out 0.4s forwards;
}

.eyebrow-chevron {
  color: var(--color-accent);
}

.title {
  margin: 0;
  font-family: 'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 56px;
  font-weight: 700;
  letter-spacing: -0.01em;
  color: var(--color-text-primary);
  display: flex;
  align-items: baseline;
}

/* Typed reveal via clip-path (not width) so the box keeps its natural size
   from the start — the cursor that follows never has to guess where to sit. */
.title-text {
  display: inline-block;
  white-space: nowrap;
  clip-path: inset(0 100% 0 0);
  animation: type-in 0.65s steps(11) 0.85s forwards;
}

@keyframes type-in {
  to {
    clip-path: inset(0 0 0 0);
  }
}

.cursor {
  display: inline-block;
  width: 4px;
  height: 0.8em;
  margin-left: 6px;
  background: var(--color-accent);
  opacity: 0;
  animation:
    cursor-in 0.1s 0.85s forwards,
    cursor-blink 0.9s steps(1) 1.5s infinite;
}

@keyframes cursor-in {
  to {
    opacity: 1;
  }
}

@keyframes cursor-blink {
  50% {
    opacity: 0;
  }
}

.description {
  max-width: 400px;
  margin: 0;
  font-size: 16px;
  line-height: 1.55;
  color: var(--color-text-secondary);
  text-align: center;
  opacity: 0;
  transform: translateY(8px);
  animation: fade-up 0.6s ease-out 1.65s forwards;
}

.cta {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  height: 46px;
  padding: 0 24px;
  margin-top: 12px;
  border: 1px solid var(--color-border-mid);
  border-radius: 8px;
  background: var(--color-bg-elevated);
  color: var(--color-text-primary);
  font-family: inherit;
  font-size: 14.5px;
  font-weight: 500;
  cursor: pointer;
  opacity: 0;
  transform: translateY(8px);
  animation: fade-up 0.6s ease-out 2s forwards;
  transition:
    background 180ms ease,
    border-color 180ms ease,
    color 180ms ease,
    transform 180ms ease;
}

.cta-arrow {
  transition: transform 180ms ease;
}

.cta:hover {
  border-color: color-mix(in srgb, var(--color-accent) 55%, var(--color-border-mid));
  color: var(--color-accent);
}

.cta:hover .cta-arrow {
  transform: translateX(3px);
}

.cta:active {
  transform: translateY(1px);
}

.cta:focus-visible {
  outline: none;
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--color-accent) 35%, transparent);
}

.hint {
  margin: 0;
  font-size: 12.5px;
  color: var(--color-text-secondary);
  opacity: 0;
  animation: fade-up 0.6s ease-out 2.2s forwards;
}

.hint kbd {
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 11px;
  padding: 1px 5px;
  border: 1px solid var(--color-border-mid);
  border-radius: 4px;
  background: var(--color-bg-elevated);
  color: var(--color-text-secondary);
}

@keyframes fade-up {
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

@media (max-width: 640px) {
  .canvas-frame {
    padding: 56px 32px;
  }
  .title {
    font-size: 36px;
  }
  .description {
    font-size: 14px;
    max-width: 280px;
  }
}

@media (prefers-reduced-motion: reduce) {
  .grid-bg,
  .bracket,
  .eyebrow,
  .title-text,
  .cursor,
  .description,
  .cta,
  .hint {
    animation: none !important;
    opacity: 1 !important;
    transform: none !important;
    clip-path: inset(0 0 0 0) !important;
  }
}
</style>
