<script setup lang="ts">
import ThemeSwitcher from '../ThemeSwitcher.vue'
</script>

<template>
  <section class="content-section">
    <h2 class="section-title">
      Appearance
    </h2>

    <div class="field-group">
      <label class="field-label">System Theme</label>
      <div style="margin-top: 4px;">
        <ThemeSwitcher />
      </div>
    </div>
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

.field-group {
  display: flex;
  flex-direction: column;
  gap: 5px;
}

.field-label {
  font-size: 12px;
  font-weight: 500;
  color: var(--color-text-secondary);
  letter-spacing: 0.01em;
}
</style>
