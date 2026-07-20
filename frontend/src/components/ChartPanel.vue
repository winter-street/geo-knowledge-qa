<script setup lang="ts">
import { use } from 'echarts/core'
import { PieChart, BarChart, LineChart } from 'echarts/charts'
import { TitleComponent, TooltipComponent, LegendComponent, GridComponent } from 'echarts/components'
import { CanvasRenderer } from 'echarts/renderers'
import VChart from 'vue-echarts'

use([PieChart, BarChart, LineChart, TitleComponent, TooltipComponent, LegendComponent, GridComponent, CanvasRenderer])

defineProps<{
  option: any
  height?: string
}>()
</script>

<template>
  <div class="chart-panel">
    <VChart :option="option" autoresize :style="{ height: height || '300px', width: '100%' }" />
  </div>
</template>

<style scoped>
.chart-panel {
  background: var(--color-surface);
  border: 1px solid var(--color-ink-100);
  border-radius: var(--radius-md);
  padding: 16px;
}
</style>
