<script setup lang="ts">
// ── Tailwind Class Extractions ──────────────────────────────────────────────
const bgClasses = 'absolute inset-0 bg-(--color-bg-base) overflow-hidden z-0 pointer-events-none'

const svgClasses = 'absolute top-0 left-0 w-full h-full [transition:fill_0.3s_ease,stroke_0.3s_ease] [&_path]:[transition:fill_0.3s_ease,stroke_0.3s_ease] [&_rect]:[transition:fill_0.3s_ease]'

const shapeGroupClasses = '[transform-origin:center] animate-[shape-breathe_8s_ease-in-out_infinite]'

const shimmerClasses = '[&>*]:animate-[shimmer_6s_ease-in-out_infinite] [&>*:nth-child(2n)]:[animation-duration:5s] [&>*:nth-child(2n)]:[animation-delay:-2s] [&>*:nth-child(3n)]:[animation-duration:7s] [&>*:nth-child(3n)]:[animation-delay:-4s]'
</script>

<template>
  <div :class="bgClasses">
    <!-- The SVG Scene -->
    <svg :class="svgClasses" viewBox="0 0 1365 685" fill="none" xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="xMidYMid slice">
      <g clip-path="url(#clip-illustration-2)">
        <!-- Background -->
        <rect width="1365" height="685" fill="var(--color-bg-base)" />

        <!-- Top-right angular shape -->
        <g :class="shapeGroupClasses">
          <path
            d="M1129.5 179.5C988.7 174.3 944.167 58 939.5 0.5H1364.5V334.5C1314.5 342 1270.3 184.7 1129.5 179.5Z"
            fill="var(--color-accent)"
            fill-opacity="0.12"
            stroke="var(--color-accent)"
            stroke-opacity="0.25"
            stroke-width="1.5"
          />
        </g>

        <!-- Bottom-left angular shape -->
        <g :class="shapeGroupClasses">
          <path
            d="M234.044 507.54C374.876 511.789 420.194 627.785 425.249 685.252L0.258787 688.124L-1.99823 354.132C47.9499 346.294 93.2119 503.292 234.044 507.54Z"
            fill="var(--color-accent)"
            fill-opacity="0.12"
            stroke="var(--color-accent)"
            stroke-opacity="0.25"
            stroke-width="1.5"
          />
        </g>

        <!-- Subtle accent dots -->
        <g :class="shimmerClasses">
          <circle cx="680" cy="340" r="2" fill="var(--color-accent)" opacity="0.4" />
          <circle cx="500" cy="200" r="1.5" fill="var(--color-accent-text)" opacity="0.3" />
          <circle cx="850" cy="500" r="1.5" fill="var(--color-accent-text)" opacity="0.3" />
          <circle cx="300" cy="100" r="1" fill="var(--color-accent)" opacity="0.25" />
          <circle cx="1100" cy="550" r="1" fill="var(--color-accent)" opacity="0.25" />
        </g>
      </g>
      <defs>
        <clipPath id="clip-illustration-2">
          <rect width="1365" height="685" fill="white" />
        </clipPath>
      </defs>
    </svg>
  </div>
</template>

<style scoped>
@keyframes shape-breathe {
  0%,
  100% {
    transform: scale(1, 1);
  }
  50% {
    transform: scale(1.005, 1.008);
  }
}

@keyframes shimmer {
  0%,
  100% {
    opacity: 0.2;
  }
  50% {
    opacity: 0.8;
  }
}
</style>
