<script setup lang="ts">
import { ref, watch } from 'vue'

const props = defineProps<{
  isStreaming: boolean
}>()

const phrases = [
  'Thinking...',
  'Changing reality...',
  'Reticulating splines...',
  'Pondering...',
  'Analyzing...',
  'Consulting the oracle...',
  'Processing thoughts...',
  'Generating brilliance...',
  'Synthesizing wisdom...',
  'Crafting response...',
  'Loading neurons...',
  'Meditating...',
  'Channeling wisdom...',
  'Orchestrating magic...',
]
const currentPhraseIndex = ref(0)

watch(
  () => props.isStreaming,
  (isStreaming, _, onCleanup) => {
    if (!isStreaming) {
      currentPhraseIndex.value = 0
      return
    }

    const interval = setInterval(() => {
      currentPhraseIndex.value = (currentPhraseIndex.value + 1) % phrases.length
    }, 2000)

    onCleanup(() => clearInterval(interval))
  },
  { immediate: true },
)
</script>

<template>
  <div v-if="isStreaming" class="typing">
    <div class="hexagon-hive">
      <div class="hex h1" />
      <div class="hex h2" />
      <div class="hex h3" />
      <div class="hex h4" />
      <div class="hex h5" />
      <div class="hex h6" />
      <div class="hex h7" />
    </div>
    <span class="typing-text">{{ phrases[currentPhraseIndex] }}</span>
  </div>
</template>

<style scoped>
.typing {
  display: flex;
  align-items: center;
  gap: 12px;
  height: 28px;
  margin-top: 4px;
}
.typing-text {
  font-size: 13px;
  color: var(--color-text-tertiary);
  font-style: italic;
  font-family: var(--font-mono);
  animation: typing-fade 1.5s infinite ease-in-out;
}
@keyframes typing-fade {
  0%,
  100% {
    opacity: 0.4;
  }
  50% {
    opacity: 1;
  }
}

/* ── hexagon hive loader ─────────────────────────────────────────────────── */
.hexagon-hive {
  position: relative;
  width: 24px;
  height: 24px;
  flex-shrink: 0;
}
.hex {
  position: absolute;
  width: 6px;
  height: 7px;
  background-color: var(--color-accent-dim);
  clip-path: polygon(50% 0%, 100% 25%, 100% 75%, 50% 100%, 0% 75%, 0% 25%);
  animation: hive-pulse 2s infinite ease-in-out;
}
/* Center */
.h1 {
  top: 8.5px;
  left: 9px;
  animation-delay: 0s;
}
/* Top */
.h2 {
  top: 2px;
  left: 9px;
  animation-delay: 0.1s;
}
/* Top Right */
.h3 {
  top: 5px;
  left: 15px;
  animation-delay: 0.2s;
}
/* Bottom Right */
.h4 {
  top: 12px;
  left: 15px;
  animation-delay: 0.3s;
}
/* Bottom */
.h5 {
  top: 15px;
  left: 9px;
  animation-delay: 0.4s;
}
/* Bottom Left */
.h6 {
  top: 12px;
  left: 3px;
  animation-delay: 0.5s;
}
/* Top Left */
.h7 {
  top: 5px;
  left: 3px;
  animation-delay: 0.6s;
}

@keyframes hive-pulse {
  0%,
  100% {
    transform: scale(0.8);
    background-color: var(--color-accent-muted);
  }
  50% {
    transform: scale(1.1);
    background-color: var(--color-accent-bright);
  }
}
</style>
