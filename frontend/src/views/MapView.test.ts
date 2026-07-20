import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const viewSource = readFileSync(new URL('./MapView.vue', import.meta.url), 'utf8')

describe('MapView spatial workbench contract', () => {
  it('exposes every spatial analysis module through one function rail', () => {
    expect(viewSource).toContain('MapFunctionRail')
    for (const label of ['空间查询', '绘制勘查区', '距离缓冲', '成矿热力', '年代演化', '区域对比', '靶区预测']) {
      expect(viewSource).toContain(label)
    }
  })

  it('runs prospectivity prediction directly from the map page', () => {
    expect(viewSource).toContain('ProspectivityPanel')
    expect(viewSource).toContain('runProspectivityPrediction')
    expect(viewSource).toContain('queryProspectivityGrid')
    expect(viewSource).toContain('currentMapBounds')
  })
})
