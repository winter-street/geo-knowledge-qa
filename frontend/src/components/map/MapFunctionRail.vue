<script setup lang="ts">
import type { Component } from 'vue'
import {
  Aim,
  Clock,
  DataAnalysis,
  Delete,
  EditPen,
  Histogram,
  LocationInformation,
  Search,
  Switch,
} from '@element-plus/icons-vue'
import type { MapFunctionId } from '@/types'

defineProps<{
  activeFunction: MapFunctionId | null
  heatmapVisible: boolean
  isSatellite: boolean
}>()

const emit = defineEmits<{
  select: [id: MapFunctionId]
  toggleBase: []
  clear: []
}>()

interface RailItem {
  id: MapFunctionId
  label: string
  icon: Component
}

const primaryItems: RailItem[] = [
  { id: 'query', label: '空间查询', icon: Search },
  { id: 'draw', label: '绘制勘查区', icon: EditPen },
  { id: 'buffer', label: '距离缓冲', icon: Aim },
]

const analysisItems: RailItem[] = [
  { id: 'heatmap', label: '成矿热力', icon: Histogram },
  { id: 'timeline', label: '年代演化', icon: Clock },
  { id: 'compare', label: '区域对比', icon: DataAnalysis },
  { id: 'prospectivity', label: '靶区预测', icon: LocationInformation },
]
</script>

<template>
  <nav class="function-rail" aria-label="地图空间功能">
    <div class="rail-group">
      <button
        v-for="item in primaryItems"
        :key="item.id"
        class="rail-button"
        :class="{ active: activeFunction === item.id }"
        :title="item.label"
        :aria-pressed="activeFunction === item.id"
        @click="emit('select', item.id)"
      >
        <component :is="item.icon" aria-hidden="true" />
        <span>{{ item.label }}</span>
      </button>
    </div>

    <div class="rail-separator" />

    <div class="rail-group">
      <button
        v-for="item in analysisItems"
        :key="item.id"
        class="rail-button"
        :class="{
          active: activeFunction === item.id,
          enabled: item.id === 'heatmap' && heatmapVisible,
        }"
        :title="item.label"
        :aria-pressed="activeFunction === item.id"
        @click="emit('select', item.id)"
      >
        <component :is="item.icon" aria-hidden="true" />
        <span>{{ item.label }}</span>
      </button>
    </div>

    <div class="rail-spacer" />

    <div class="rail-group rail-utilities">
      <button class="rail-button" :class="{ enabled: isSatellite }" title="切换底图" @click="emit('toggleBase')">
        <Switch aria-hidden="true" />
        <span>{{ isSatellite ? '卫星底图' : '标准底图' }}</span>
      </button>
      <button class="rail-button danger" title="清除地图结果" @click="emit('clear')">
        <Delete aria-hidden="true" />
        <span>清除</span>
      </button>
    </div>
  </nav>
</template>

<style scoped>
.function-rail {
  position: relative;
  z-index: 8;
  display: flex;
  flex-direction: column;
  width: 76px;
  min-width: 76px;
  padding: 8px 6px;
  border-right: 1px solid var(--color-ink-100);
  background: var(--color-bg-subtle);
  overflow-y: auto;
}

.rail-group { display: flex; flex-direction: column; gap: 3px; }
.rail-spacer { flex: 1; min-height: 12px; }
.rail-separator { height: 1px; margin: 7px 6px; background: var(--color-ink-100); }
.rail-utilities { padding-top: 7px; border-top: 1px solid var(--color-ink-100); }

.rail-button {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 4px;
  min-height: 55px;
  padding: 6px 3px;
  border: 1px solid transparent;
  border-radius: var(--radius-md);
  background: transparent;
  color: var(--color-ink-500);
  font-family: var(--font-body);
  cursor: pointer;
}

.rail-button svg { width: 18px; height: 18px; }
.rail-button span { max-width: 64px; font-size: 10px; line-height: 1.25; text-align: center; overflow-wrap: anywhere; }
.rail-button:hover, .rail-button:focus-visible { border-color: var(--color-ink-100); background: var(--color-surface); color: var(--color-ink-900); outline: none; }
.rail-button.active { border-color: var(--color-primary); background: var(--color-primary-light); color: var(--color-primary); }
.rail-button.active::before { content: ''; position: absolute; left: -7px; top: 10px; bottom: 10px; width: 2px; background: var(--color-primary); }
.rail-button.enabled:not(.active) { color: var(--color-accent); }
.rail-button.danger:hover, .rail-button.danger:focus-visible { color: var(--color-danger); }

@media (max-width: 720px) {
  .function-rail {
    flex-direction: row;
    width: 100%;
    min-width: 0;
    height: 66px;
    min-height: 66px;
    padding: 4px 6px;
    border-right: 0;
    border-bottom: 1px solid var(--color-ink-100);
    overflow-x: auto;
    overflow-y: hidden;
  }
  .rail-group { flex-direction: row; }
  .rail-separator { width: 1px; height: 42px; margin: 7px 4px; flex-shrink: 0; }
  .rail-spacer { min-width: 8px; min-height: 0; }
  .rail-utilities { flex-direction: row; padding-top: 0; padding-left: 7px; border-top: 0; border-left: 1px solid var(--color-ink-100); }
  .rail-button { min-width: 64px; min-height: 55px; flex-shrink: 0; }
  .rail-button.active::before { left: 9px; right: 9px; top: auto; bottom: -5px; width: auto; height: 2px; }
}
</style>
