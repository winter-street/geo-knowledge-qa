<script setup lang="ts">
import type { Source } from '@/types'

defineProps<{ source: Source; index?: number }>()
</script>

<template>
  <div class="src-ref">
    <span class="mark">[{{ index || '·' }}]</span>
    <span class="text">{{ source.docTitle }} p.{{ source.page }}</span>
  </div>
</template>

<style scoped>
.src-ref {
  font-size: 12px;
  color: var(--color-ink-500);
  display: flex;
  gap: 6px;
  align-items: baseline;
  line-height: 1.4;
}

.mark {
  font-family: var(--font-display);
  font-style: italic;
  color: var(--color-primary);
  font-weight: 600;
  flex-shrink: 0;
}

.text {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
</style>
