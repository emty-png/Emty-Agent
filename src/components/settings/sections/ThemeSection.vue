<script setup lang="ts">
import ThemeSwitcher from '../ThemeSwitcher.vue'
</script>

<template>
  <section class="content-section">
    <h2 class="section-title">
      Appearance
    </h2>

    <ThemeSwitcher />
  </section>
</template>

<style scoped>
.content-section {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.section-title {
  font-size: 18px;
  font-weight: 600;
  color: var(--color-text-primary);
  letter-spacing: -0.01em;
  margin-bottom: 4px;
}
</style>
