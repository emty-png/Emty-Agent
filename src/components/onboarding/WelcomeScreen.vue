<script setup lang="ts">
import { onMounted, onUnmounted, useTemplateRef } from 'vue'

const emit = defineEmits<{ next: [] }>()

const svgEl = useTemplateRef<SVGSVGElement>('pinwheel')
let timer: ReturnType<typeof setTimeout> | null = null
let rotateAnim: Animation | null = null
let scaleAnim: Animation | null = null
let opacityAnim: Animation | null = null

onMounted(() => {
  const svg = svgEl.value
  if (svg && typeof svg.animate === 'function') {
    // Fade in almost instantly - this should never be the thing the eye tracks.
    opacityAnim = svg.animate(
      [{ opacity: 0 }, { opacity: 1 }],
      { duration: 180, easing: 'linear', fill: 'forwards' },
    )

    // Pop in with a soft spring overshoot (settles past 1 then eases back to
    // it) so it feels like it "lands" rather than just fading up in size.
    scaleAnim = svg.animate(
      [{ scale: '0.04' }, { scale: '1' }],
      {
        duration: 650,
        easing: 'cubic-bezier(0.34, 1.56, 0.64, 1)',
        fill: 'forwards',
      },
    )

    // Spin independently of scale/opacity, like it's been flicked: nearly all
    // the speed is spent in the first third, then a long, slow, honest decay
    // to a stop - no artificial hold at the end, it just naturally runs out.
    // 1087deg = 3 full turns + a few degrees, landing on the angle that keeps
    // the 3-blade shape's weight most evenly spread across the frame at rest.
    rotateAnim = svg.animate(
      [{ rotate: '0deg' }, { rotate: '1087deg' }],
      {
        duration: 2000,
        easing: 'cubic-bezier(0.11, 0.85, 0.13, 1)',
        fill: 'forwards',
      },
    )
  }

  timer = setTimeout(() => {
    emit('next')
  }, 3000)
})

onUnmounted(() => {
  if (timer) {
    clearTimeout(timer)
    timer = null
  }
  for (const a of [rotateAnim, scaleAnim, opacityAnim]) {
    a?.cancel()
  }
  rotateAnim = null
  scaleAnim = null
  opacityAnim = null
})
</script>

<template>
  <div class="welcome-root">
    <div class="logo-wrap">
      <svg ref="pinwheel" class="pinwheel" viewBox="0 0 200 200" xmlns="http://www.w3.org/2000/svg">
        <g>
          <polygon class="blade" points="100,100 183.45,66.29 109.56,55.01" transform="rotate(0 100 100)" />
          <polygon class="blade" points="100,100 183.45,66.29 109.56,55.01" transform="rotate(120 100 100)" />
          <polygon class="blade" points="100,100 183.45,66.29 109.56,55.01" transform="rotate(240 100 100)" />
        </g>
      </svg>
    </div>
  </div>
</template>

<style scoped>
.welcome-root {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  height: 100%;
  flex: 1;
  background: var(--color-bg-base);
}

.logo-wrap {
  width: min(46vw, 46vh, 260px);
  aspect-ratio: 1 / 1;
}

.pinwheel {
  display: block;
  width: 100%;
  height: 100%;
  overflow: visible;
  transform-box: view-box;
  transform-origin: 50% 50%;
}

.blade {
  fill: var(--color-text-primary);
  transition: fill 0.5s ease;
}
</style>