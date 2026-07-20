<script setup lang="ts">
defineProps<{
  label: string
  value: string | number
  unit?: string
}>()
</script>

<template>
  <div class="stat-card">
    <div class="stat-label">{{ label }}</div>
    <div class="stat-value">{{ value }}<span v-if="unit" class="stat-unit">{{ unit }}</span></div>
    <div class="stat-rule" />
  </div>
</template>

<style scoped>
.stat-card {
  flex: 1;
  background: var(--color-surface);
  border: 1px solid var(--color-ink-100);
  border-radius: var(--radius-md);
  padding: 18px 20px;
  position: relative;
}

.stat-label {
  font-size: 11px;
  color: var(--color-ink-500);
  font-weight: 600;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  margin-bottom: 8px;
}

.stat-value {
  font-family: var(--font-display);
  font-size: 28px;
  font-weight: 700;
  color: var(--color-ink-900);
  letter-spacing: -0.02em;
}

.stat-unit {
  font-size: 13px;
  color: var(--color-ink-500);
  margin-left: 4px;
  font-family: var(--font-body);
  font-weight: 500;
}

.stat-rule {
  width: 24px;
  height: 1px;
  background: var(--color-primary);
  margin-top: 12px;
}
</style>
