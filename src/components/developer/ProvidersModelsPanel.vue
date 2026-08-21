<script setup lang="ts">
</script>

<template>
  <div class="providers-models-root">
    <div class="coming-soon">
      <span class="coming-soon-title">Nothing to see here...</span>
    </div>
  </div>
</template>

<style scoped>
.providers-models-root {
  display: flex;
  flex: 1;
  min-height: 0;
  min-width: 0;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  overflow: auto;
  background: var(--color-bg-base);
  padding: 24px;
}

.coming-soon {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  text-align: center;
}

.coming-soon-title {
  font-size: 14px;
  font-weight: 500;
  color: var(--color-text-secondary);
}
</style>
