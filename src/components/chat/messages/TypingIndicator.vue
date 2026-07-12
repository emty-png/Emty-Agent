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

// ── Tailwind Class Extractions ──────────────────────────────────────────────
const typingClasses = 'flex items-center gap-3 h-7 mt-1'
const typingTextClasses = 'text-[13px] text-(--color-text-tertiary) italic font-[var(--font-mono)] animate-[typing-fade_1.5s_infinite_ease-in-out]'

const hexagonHiveClasses = 'relative w-6 h-6 shrink-0'

const hexBase = 'absolute w-1.5 h-[7px] bg-(--color-accent-dim) [clip-path:polygon(50%_0%,100%_25%,100%_75%,50%_100%,0%_75%,0%_25%)] animate-[hive-pulse_2s_infinite_ease-in-out]'
// Positions/delays correspond to the original .h1–.h7 hexagon layout (center, then clockwise from top)
const h1Classes = `${hexBase} top-[8.5px] left-[9px] [animation-delay:0s]`
const h2Classes = `${hexBase} top-0.5 left-[9px] [animation-delay:0.1s]`
const h3Classes = `${hexBase} top-[5px] left-[15px] [animation-delay:0.2s]`
const h4Classes = `${hexBase} top-3 left-[15px] [animation-delay:0.3s]`
const h5Classes = `${hexBase} top-[15px] left-[9px] [animation-delay:0.4s]`
const h6Classes = `${hexBase} top-3 left-[3px] [animation-delay:0.5s]`
const h7Classes = `${hexBase} top-[5px] left-[3px] [animation-delay:0.6s]`
</script>

<template>
  <div v-if="isStreaming" :class="typingClasses">
    <div :class="hexagonHiveClasses">
      <div :class="h1Classes" />
      <div :class="h2Classes" />
      <div :class="h3Classes" />
      <div :class="h4Classes" />
      <div :class="h5Classes" />
      <div :class="h6Classes" />
      <div :class="h7Classes" />
    </div>
    <span :class="typingTextClasses">{{ phrases[currentPhraseIndex] }}</span>
  </div>
</template>

<!-- Note: Removed the "scoped" attribute from the style tag.
     Vue scopes @keyframes by renaming them (e.g. typing-fade-xxxx),
     which breaks Tailwind arbitrary animation classes because they statically output
     `animation: typing-fade ...` which expects the global keyframe name. -->
<style>
@keyframes typing-fade {
  0%,
  100% {
    opacity: 0.4;
  }
  50% {
    opacity: 1;
  }
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
