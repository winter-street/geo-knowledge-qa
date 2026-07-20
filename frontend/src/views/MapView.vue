<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, nextTick, watch } from 'vue'
import { useRoute } from 'vue-router'
import AMapLoader from '@amap/amap-jsapi-loader'
import { Close, Download } from '@element-plus/icons-vue'
import { featuresToSpatialData, queryProspectivityGrid, querySpatial } from '@/api/spatial'
import MapFunctionRail from '@/components/map/MapFunctionRail.vue'
import ProspectivityPanel from '@/components/map/ProspectivityPanel.vue'
import type { GeoPoint, MapFunctionId, ProspectivityGridResult, ProspectivityGridCell, ProspectivityTarget, SpatialAnalysis, SpatialData } from '@/types'
import { applyChinaMapConstraints, CHINA_MAP_CENTER, CHINA_MAP_ZOOM_RANGE } from '@/utils/amap'
import { owlTypeMeta } from '@/utils/owl'
import { spatialDataToCsv, spatialDataToGeoJson, spatialExportFilename } from '@/utils/spatial-export'
import { filterSpatialData, markerHasEra } from '@/utils/spatial-temporal'
import { useSpatialTaskStore } from '@/stores/spatial-task'
import { filterSpatialTaskData, toMapViewState, type SpatialTaskSnapshot } from '@/utils/map-plan'
import {
  gridCellColor,
} from '@/utils/prospectivity-grid'

const amapKey = import.meta.env.VITE_AMAP_KEY
const amapSecret = import.meta.env.VITE_AMAP_SECRET
const route = useRoute()
const spatialTask = useSpatialTaskStore()

// 地图工作台
const activeTool = ref(-1)
const activeFunction = ref<MapFunctionId | null>(null)
const functionTitles: Record<MapFunctionId, string> = {
  query: '空间查询',
  draw: '绘制勘查区',
  buffer: '距离缓冲',
  heatmap: '成矿热力',
  timeline: '年代演化',
  compare: '区域对比',
  prospectivity: '靶区预测',
}
const mapContainer = ref<HTMLDivElement | null>(null)
const isSatellite = ref(false)

// 空间搜索
const spatialKeyword = ref('')
const spatialLoading = ref(false)
const spatialInput = ref<HTMLInputElement | null>(null)
const spatialSource = ref<'neo4j' | 'mock' | 'mixed' | 'none'>('none')
const spatialAnalysis = ref<SpatialAnalysis | null>(null)
const resultMode = ref<'query' | 'score'>('query')
const selectedEra = ref<string | null>(null)
const selectedRegion = ref<string | null>(null)
const timelinePlaying = ref(false)
let timelineTimer: ReturnType<typeof setInterval> | null = null

let AMap: any = null
let map: any = null
let mouseTool: any = null
let drawnOverlays: any[] = []
let spatialOverlays: any[] = []
let gridOverlays: any[] = []
let gridSelectionOverlays: any[] = []
const gridTargetOverlays = new Map<string, any[]>()
const markerOverlays = new Map<string, any>()
let heatmap: any = null
const heatmapVisible = ref(false)
const currentSpatialData = ref<SpatialData>({ markers: [], polylines: [] })
const gridResult = ref<ProspectivityGridResult | null>(null)
const selectedGridCell = ref<ProspectivityGridCell | null>(null)
const prospectivityQuery = ref('攀枝花 钒钛磁铁矿')
const prospectivityGridSize = ref<5 | 10 | 20>(10)
const prospectivityMinimumScore = ref(85)
const prospectivityLoading = ref(false)
let gridTaskId = ''

const panelTitle = computed(() => activeFunction.value ? functionTitles[activeFunction.value] : '')

const regionSummaries = computed(() => spatialAnalysis.value?.regions || [])
const regionMarkers = computed(() => (currentSpatialData.value.markers || [])
  .filter((marker) => !selectedRegion.value || marker.region === selectedRegion.value),
)
const regionUnknownEraCount = computed(() => regionMarkers.value.filter((marker) => !marker.era).length)
const temporalBuckets = computed(() => {
  const buckets = spatialAnalysis.value?.temporal?.buckets || []
  if (!selectedRegion.value) return buckets
  return buckets.map((bucket) => {
    const points = regionMarkers.value.filter((marker) => markerHasEra(marker, bucket.era))
    return {
      ...bucket,
      count: points.length,
      mineralCount: points.filter((point) => point.type === 'Mineral').length,
      rockCount: points.filter((point) => point.type === 'Rock').length,
      highProspectivityCount: points.filter((point) => point.prospectivity?.level === 'high').length,
    }
  }).filter((bucket) => bucket.count > 0)
})
const displayedSpatialData = computed<SpatialData>(() =>
  filterSpatialData(currentSpatialData.value, {
    era: selectedEra.value,
    region: selectedRegion.value,
  }),
)
const displayedMockCount = computed(() => [
  ...(displayedSpatialData.value.markers || []),
  ...(displayedSpatialData.value.polylines || []),
].filter((item) => item.isMock).length)
const visibleProspectivity = computed(() => {
  const markers = (displayedSpatialData.value.markers || []).filter((marker) => marker.prospectivity)
  const top = [...markers].sort((left, right) => right.prospectivity!.score - left.prospectivity!.score)[0]
  return {
    high: markers.filter((marker) => marker.prospectivity?.level === 'high').length,
    medium: markers.filter((marker) => marker.prospectivity?.level === 'medium').length,
    low: markers.filter((marker) => marker.prospectivity?.level === 'low').length,
    top,
  }
})
const visibleNearest = computed(() =>
  [...(displayedSpatialData.value.markers || [])]
    .filter((marker) => marker.distanceKm !== undefined)
    .sort((left, right) => left.distanceKm! - right.distanceKm!)[0],
)
const hasScores = computed(() => (displayedSpatialData.value.markers || []).some((marker) => marker.prospectivity))
const rankedPool = computed(() => {
  const markers = [...(displayedSpatialData.value.markers || [])]
  if (resultMode.value === 'score') {
    return markers
      .filter((marker) => marker.prospectivity)
      .sort((left, right) => right.prospectivity!.score - left.prospectivity!.score)
  }
  return markers
})
const rankedResults = computed(() => rankedPool.value.slice(0, 12))
const resultOverflow = computed(() => Math.max(0, rankedPool.value.length - rankedResults.value.length))

// ---- 空间搜索 ----
const typeColors: Record<string, string> = {
  Mineral: '#B83A1F', Rock: '#2E7D5B', Structure: '#1E3A5F',
  TimePeriod: '#B8860B', DepositType: '#8B5CF6',
}

async function searchSpatial() {
  const keyword = spatialKeyword.value.trim()
  if (!map || !AMap || !keyword) return
  spatialTask.clear()
  clearGridState()
  spatialLoading.value = true
  try {
    const result = await querySpatial({ question: keyword, includeMock: true })
    const data = featuresToSpatialData(result.features)
    showSpatialData(data, result.source || 'none', result.analysis)
    const count = (data.markers?.length || 0) + (data.polylines?.length || 0)
    const { ElMessage } = await import('element-plus')
    if (count > 0) {
      ElMessage.success(`已显示 ${count} 个相关空间要素`)
    } else {
      ElMessage.info('未查询到可展示的空间要素')
    }
  } catch {
    const { ElMessage } = await import('element-plus')
    ElMessage.error('空间查询失败，请稍后重试')
  }
  finally { spatialLoading.value = false }
}

function routeTaskId(): string {
  return Array.isArray(route.query.task) ? String(route.query.task[0] || '') : String(route.query.task || '')
}

let appliedTaskId = ''

async function applySpatialTask(snapshot: SpatialTaskSnapshot) {
  if (routeTaskId() !== snapshot.planId || appliedTaskId === snapshot.planId || !snapshot.data) return
  appliedTaskId = snapshot.planId
  const viewState = toMapViewState(snapshot)
  const queryAction = snapshot.plan.actions.find((action) => action.type === 'query')
  spatialKeyword.value = queryAction?.type === 'query' ? queryAction.question : snapshot.plan.title
  prospectivityQuery.value = spatialKeyword.value
  activeFunction.value = snapshot.grid ? 'prospectivity' : 'query'
  currentSpatialData.value = filterSpatialTaskData(snapshot)
  spatialAnalysis.value = snapshot.analysis ?? null
  selectedRegion.value = viewState.selectedRegion
  selectedEra.value = viewState.selectedEra
  resultMode.value = viewState.resultMode
  spatialSource.value = [
    ...(currentSpatialData.value.markers || []),
    ...(currentSpatialData.value.polylines || []),
  ].some((item) => item.isMock) ? 'mock' : 'neo4j'

  for (const action of snapshot.plan.actions) {
    if (!['heatmap', 'timeline', 'grid-prediction'].includes(action.type)) {
      spatialTask.markAction(action.type, 'success')
    }
  }

  if (!snapshot.grid) {
    clearGridState()
  } else if (gridTaskId !== snapshot.planId) {
    clearGridState()
    gridTaskId = snapshot.planId
    try {
      prospectivityGridSize.value = snapshot.grid.gridSizeKm
      prospectivityMinimumScore.value = snapshot.grid.minimumScore
      gridResult.value = await queryProspectivityGrid({
        question: spatialKeyword.value,
        gridSizeKm: snapshot.grid.gridSizeKm,
        minimumScore: snapshot.grid.minimumScore,
      })
      selectedGridCell.value = [...gridResult.value.cells].sort((left, right) => right.score - left.score)[0] || null
      spatialTask.markAction('grid-prediction', 'success')
    } catch (error) {
      gridResult.value = null
      clearGridOverlays()
      spatialTask.markAction('grid-prediction', 'failed', error instanceof Error ? error.message : '网格预测失败')
    }
  }

  if (!map || !AMap) return
  clearSpatialOverlays()
  renderSpatialData(displayedSpatialData.value, true)
  if (gridResult.value) renderGridResult(gridResult.value)

  if (viewState.heatmapVisible && !heatmapVisible.value) {
    await toggleHeatmap()
    spatialTask.markAction('heatmap', heatmapVisible.value ? 'success' : 'failed')
  }
  if (viewState.timelineMode === 'play') {
    toggleTimelinePlayback()
    spatialTask.markAction('timeline', timelinePlaying.value ? 'success' : 'skipped')
  } else if (snapshot.plan.actions.some((action) => action.type === 'timeline')) {
    spatialTask.markAction('timeline', 'success')
  }
}

function showSpatialData(
  data: SpatialData,
  source: 'neo4j' | 'mock' | 'mixed' | 'none',
  analysis?: SpatialAnalysis,
) {
  stopTimelinePlayback()
  clearGridState()
  selectedEra.value = null
  selectedRegion.value = null
  clearSpatialOverlays()
  currentSpatialData.value = data
  spatialSource.value = source
  spatialAnalysis.value = analysis || null
  resultMode.value = analysis?.interpretation.sortBy === 'score' ? 'score' : 'query'
  renderSpatialData(displayedSpatialData.value)
  refreshHeatmap()
}

function sourceLabel() {
  if (spatialSource.value === 'neo4j') return '真实坐标数据'
  if (spatialSource.value === 'mock') return '功能演示数据'
  if (spatialSource.value === 'mixed') return '真实 + 演示数据'
  return ''
}

function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;')
}

function clearGridOverlays() {
  for (const overlay of gridOverlays) overlay.remove?.()
  for (const overlay of gridSelectionOverlays) overlay.remove?.()
  gridOverlays = []
  gridSelectionOverlays = []
  gridTargetOverlays.clear()
}

function clearGridState() {
  clearGridOverlays()
  gridResult.value = null
  selectedGridCell.value = null
  gridTaskId = ''
}

function renderGridSelection(cell: ProspectivityGridCell) {
  for (const overlay of gridSelectionOverlays) overlay.remove?.()
  gridSelectionOverlays = []
  if (!map || !AMap) return
  for (const ring of cell.coordinates) {
    const outline = new AMap.Polygon({
      path: ring,
      strokeColor: '#1A1A2E',
      strokeWeight: 3,
      strokeOpacity: 1,
      fillColor: '#FFFFFF',
      fillOpacity: 0.04,
      zIndex: 17,
    })
    outline.setMap(map)
    gridSelectionOverlays.push(outline)
  }
}

function selectGridCell(cell: ProspectivityGridCell, focus = false) {
  selectedGridCell.value = cell
  activeFunction.value = 'prospectivity'
  renderGridSelection(cell)
  if (focus && map) {
    map.setZoomAndCenter(Math.max(Number(map.getZoom?.() || 7), 9), cell.center)
  }
}

function renderGridResult(result: ProspectivityGridResult) {
  clearGridOverlays()
  if (!map || !AMap) return

  for (const cell of result.cells) {
    const color = gridCellColor(cell.score)
    for (const ring of cell.coordinates) {
      const polygon = new AMap.Polygon({
        path: ring,
        strokeColor: color,
        strokeWeight: 1,
        strokeOpacity: 0.5,
        fillColor: color,
        fillOpacity: cell.level === 'high' ? 0.3 : 0.18,
        zIndex: 8,
      })
      polygon.setMap(map)
      polygon.on('click', () => selectGridCell(cell))
      gridOverlays.push(polygon)
    }

    if (result.cells.length <= 700 || cell.level !== 'low') {
      const label = new AMap.Marker({
        position: cell.center,
        anchor: 'center',
        title: `${cell.id} · ${cell.score} 分`,
        content: `<button type="button" aria-label="${escapeHtml(cell.id)} ${cell.score} 分" style="min-width:25px;height:21px;padding:0 4px;border:1px solid rgba(255,255,255,.85);border-radius:2px;background:${color};color:#fff;font:600 10px Inter,Arial,sans-serif;cursor:pointer">${cell.score}</button>`,
        zIndex: 14,
      })
      label.setMap(map)
      label.on('click', () => selectGridCell(cell))
      gridOverlays.push(label)
    }
  }

  for (const target of result.targets) {
    const overlays: any[] = []
    for (const polygonCoordinates of target.coordinates) {
      if (!polygonCoordinates.length) continue
      const polygon = new AMap.Polygon({
        path: polygonCoordinates,
        strokeColor: '#1A1A2E',
        strokeWeight: 4,
        strokeOpacity: 0.9,
        fillColor: '#B83A1F',
        fillOpacity: 0.04,
        zIndex: 18,
      })
      polygon.setMap(map)
      polygon.on('click', () => focusGridTarget(target))
      overlays.push(polygon)
      gridOverlays.push(polygon)
    }
    gridTargetOverlays.set(target.id, overlays)
  }

  if (gridOverlays.length) {
    map.setFitView([...spatialOverlays, ...gridOverlays], false, [70, 70, 70, 70])
  }
  if (selectedGridCell.value) renderGridSelection(selectedGridCell.value)
}

function focusGridTarget(target: ProspectivityTarget) {
  const overlays = gridTargetOverlays.get(target.id) || []
  if (!map || !overlays.length) return
  activeFunction.value = 'prospectivity'
  map.setFitView(overlays, false, [90, 90, 90, 90])
}

function markerInfo(marker: GeoPoint): string {
  const rows = [
    marker.region ? `区域：${marker.region}` : '',
    marker.era ? `时代：${marker.era}` : '',
    marker.depositType ? `成因：${marker.depositType}` : '',
    marker.owlTypes?.length ? `OWL：${marker.owlTypes.map((type) => owlTypeMeta(type).label).join('、')}` : '',
    marker.distanceKm !== undefined ? `距参照：${marker.distanceKm.toFixed(2)} km` : '',
    marker.detail || '',
  ].filter(Boolean)
  const mock = marker.isMock
    ? '<div style="margin-top:7px;padding-top:6px;border-top:1px solid #E2DFD6;color:#9A6514">功能演示数据，不作为实际勘查依据</div>'
    : ''
  const scoreBlock = marker.prospectivity
    ? `<div style="margin-top:8px;padding-top:7px;border-top:1px solid #E2DFD6"><div style="display:flex;justify-content:space-between;gap:12px"><b>演示有利度</b><strong style="color:${scoreColor(marker)}">${marker.prospectivity.score} 分</strong></div>${marker.prospectivity.factors.map((factor) => `<div style="display:grid;grid-template-columns:1fr auto;gap:8px;margin-top:4px"><span>${escapeHtml(factor.label)}：${escapeHtml(factor.evidence)}</span><b>${factor.score}/${factor.maxScore}</b></div>`).join('')}</div>`
    : ''
  return `<div style="padding:9px 12px;font-size:12px;line-height:1.65;max-width:310px"><b>${escapeHtml(marker.name)}</b><br/>${rows.map(escapeHtml).join('<br/>')}${scoreBlock}${mock}</div>`
}

function openMarkerInfo(marker: GeoPoint, overlay: any) {
  new AMap.InfoWindow({ content: markerInfo(marker), offset: [0, -24] })
    .open(map, overlay.getPosition())
}

function scoreColor(marker: GeoPoint): string {
  if (marker.prospectivity?.level === 'high') return '#2E7D5B'
  if (marker.prospectivity?.level === 'medium') return '#B8860B'
  if (marker.prospectivity?.level === 'low') return '#B83A1F'
  return typeColors[marker.type] || '#666'
}

function renderSpatialData(data: SpatialData, fitView = true) {
  if (!data || (!data.markers?.length && !data.polylines?.length)) return

  const allLngs: number[] = []
  const allLats: number[] = []

  for (const m of (data.markers || [])) {
    allLngs.push(m.lng); allLats.push(m.lat)
    const showLabel = m.isAnchor || !m.isMock
    const owlRing = m.owlTypes?.length ? '0 0 0 2px #E8F5EF,0 0 0 3px #2E7D5B' : '0 0 0 1px rgba(26,26,46,.18)'
    const pointColor = resultMode.value === 'score' ? scoreColor(m) : (typeColors[m.type] || '#666')
    const scorePoint = resultMode.value === 'score' && m.prospectivity
    const marker = new AMap.Marker({
      position: [m.lng, m.lat],
      title: m.name,
      content: showLabel && !scorePoint
        ? undefined
        : `<span style="display:block;width:${scorePoint ? 11 : 7}px;height:${scorePoint ? 11 : 7}px;border:1px solid #fff;background:${pointColor};box-shadow:${owlRing}"></span>`,
      label: showLabel ? {
        content: `<span style="background:${pointColor};color:#fff;padding:2px 6px;border-radius:2px;font-size:10px;white-space:nowrap">${escapeHtml(m.name)}</span>`,
        direction: 'top',
      } : undefined,
    })
    marker.setMap(map)
    spatialOverlays.push(marker)
    markerOverlays.set(m.id, marker)
    marker.on('click', () => openMarkerInfo(m, marker))
  }

  for (const p of (data.polylines || [])) {
    p.path.forEach((c) => { allLngs.push(c[0]); allLats.push(c[1]) })
    const poly = new AMap.Polyline({
      path: p.path,
      strokeColor: '#1E3A5F', strokeWeight: 3, strokeOpacity: 0.7, strokeStyle: 'dashed',
    })
    poly.setMap(map)
    spatialOverlays.push(poly)
    if (p.label) {
      const mid = p.path[Math.floor(p.path.length / 2)]
      const m = new AMap.Marker({
        position: mid,
        label: { content: `<span style="background:rgba(30,58,95,0.85);color:#fff;padding:1px 6px;border-radius:2px;font-size:10px">${p.label}</span>`, direction: 'center' },
      })
      m.setMap(map)
      spatialOverlays.push(m)
    }
  }

  if (fitView && allLngs.length > 0) {
    map.setFitView(spatialOverlays, false, [80, 80, 80, 80])
  }
}

function clearSpatialOverlays() {
  for (const o of spatialOverlays) o.remove?.()
  spatialOverlays = []
  markerOverlays.clear()
}

function refreshHeatmap() {
  if (!heatmap || !heatmapVisible.value) return
  const data = (displayedSpatialData.value.markers || []).map((marker) => ({
    lng: marker.lng,
    lat: marker.lat,
    count: marker.type === 'Mineral' ? 3 : 1,
  }))
  heatmap.setDataSet({ data, max: 3 })
}

async function toggleHeatmap() {
  if (!map || !AMap) return
  if (!(displayedSpatialData.value.markers?.length)) {
    const { ElMessage } = await import('element-plus')
    ElMessage.info('请先查询并显示矿产或岩石空间数据')
    return
  }

  if (heatmapVisible.value && heatmap) {
    heatmap.hide()
    heatmapVisible.value = false
    activeTool.value = -1
    return
  }

  await new Promise<void>((resolve) => {
    map.plugin(['AMap.HeatMap'], () => {
      if (!heatmap) {
        heatmap = new AMap.HeatMap(map, {
          radius: 28,
          opacity: [0, 0.75],
          gradient: { 0.25: '#2E7D5B', 0.5: '#B8860B', 0.75: '#B83A1F', 1: '#7A1F16' },
        })
      }
      heatmapVisible.value = true
      refreshHeatmap()
      heatmap.show()
      resolve()
    })
  })
}

function focusResult(item: GeoPoint) {
  const overlay = markerOverlays.get(item.id)
  if (!overlay || !map) return
  map.setZoomAndCenter(Math.max(Number(map.getZoom?.() || 7), 9), [item.lng, item.lat])
  openMarkerInfo(item, overlay)
}

function setResultMode(mode: 'query' | 'score') {
  if (mode === 'score' && !hasScores.value) return
  if (resultMode.value === mode) return
  resultMode.value = mode
  clearSpatialOverlays()
  renderSpatialData(displayedSpatialData.value, false)
}

function renderTimelineSelection(era: string | null) {
  selectedEra.value = era
  clearSpatialOverlays()
  renderSpatialData(displayedSpatialData.value, false)
  refreshHeatmap()
}

function selectEra(era: string | null) {
  stopTimelinePlayback()
  renderTimelineSelection(era)
}

function selectRegion(region: string | null) {
  stopTimelinePlayback()
  selectedRegion.value = region
  if (selectedEra.value && !(currentSpatialData.value.markers || []).some((marker) =>
    (!region || marker.region === region) && markerHasEra(marker, selectedEra.value!),
  )) {
    selectedEra.value = null
  }
  clearSpatialOverlays()
  renderSpatialData(displayedSpatialData.value, true)
  refreshHeatmap()
}

function stopTimelinePlayback() {
  if (timelineTimer) clearInterval(timelineTimer)
  timelineTimer = null
  timelinePlaying.value = false
}

function toggleTimelinePlayback() {
  if (timelinePlaying.value) {
    stopTimelinePlayback()
    return
  }
  const buckets = temporalBuckets.value
  if (!buckets.length) return
  let index = selectedEra.value
    ? buckets.findIndex((bucket) => bucket.era === selectedEra.value)
    : -1
  if (index >= buckets.length - 1) index = -1
  timelinePlaying.value = true

  const advance = () => {
    index += 1
    if (index >= buckets.length) {
      stopTimelinePlayback()
      return
    }
    renderTimelineSelection(buckets[index]!.era)
  }
  advance()
  timelineTimer = setInterval(advance, 1600)
}

function downloadBlob(content: string, mime: string, filename: string) {
  const url = URL.createObjectURL(new Blob([content], { type: mime }))
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.click()
  URL.revokeObjectURL(url)
}

function exportGeoJson() {
  downloadBlob(
    spatialDataToGeoJson(displayedSpatialData.value),
    'application/geo+json;charset=utf-8',
    spatialExportFilename('geojson'),
  )
}

function exportCsv() {
  downloadBlob(
    spatialDataToCsv(displayedSpatialData.value),
    'text/csv;charset=utf-8',
    spatialExportFilename('csv'),
  )
}

function analysisConditions(): string[] {
  const parsed = spatialAnalysis.value?.interpretation
  if (!parsed) return []
  return [
    parsed.anchorName ? `参照：${parsed.anchorName}` : '',
    parsed.radiusKm ? `半径：${parsed.radiusKm} km` : '',
    parsed.mineralKinds.length ? `矿种：${parsed.mineralKinds.join('、')}` : '',
    parsed.timePeriods.length ? `时代：${parsed.timePeriods.join('、')}` : '',
    parsed.depositTypes.length ? `成因：${parsed.depositTypes.join('、')}` : '',
    parsed.owlTypes.length ? `OWL：${parsed.owlTypes.map((type) => owlTypeMeta(type).label).join('、')}` : '',
  ].filter(Boolean)
}

function currentMapBounds(): [number, number, number, number] | undefined {
  const bounds = map?.getBounds?.()
  const southWest = bounds?.getSouthWest?.()
  const northEast = bounds?.getNorthEast?.()
  if (!southWest || !northEast) return undefined
  const bbox: [number, number, number, number] = [
    Number(southWest.lng ?? southWest.getLng?.()),
    Number(southWest.lat ?? southWest.getLat?.()),
    Number(northEast.lng ?? northEast.getLng?.()),
    Number(northEast.lat ?? northEast.getLat?.()),
  ]
  return bbox.every(Number.isFinite) ? bbox : undefined
}

async function runProspectivityPrediction() {
  const question = prospectivityQuery.value.trim()
  if (!question || prospectivityLoading.value) return
  prospectivityLoading.value = true
  spatialTask.clear()
  stopTimelinePlayback()
  try {
    const result = await queryProspectivityGrid({
      question,
      gridSizeKm: prospectivityGridSize.value,
      minimumScore: prospectivityMinimumScore.value,
      bbox: currentMapBounds(),
    })
    clearSpatialOverlays()
    clearGridOverlays()
    gridResult.value = result
    selectedGridCell.value = [...result.cells].sort((left, right) => right.score - left.score)[0] || null
    currentSpatialData.value = result.spatialData || { markers: [], polylines: [] }
    spatialAnalysis.value = result.analysis || null
    spatialSource.value = result.source || 'none'
    spatialKeyword.value = question
    resultMode.value = 'score'
    renderSpatialData(currentSpatialData.value, false)
    renderGridResult(result)
    const { ElMessage } = await import('element-plus')
    if (result.cells.length) {
      ElMessage.success(`预测完成：${result.cells.length} 个网格，${result.targets.length} 个靶区`)
    } else {
      ElMessage.info('当前地图范围和条件下没有形成可评分网格')
    }
  } catch (error) {
    const { ElMessage } = await import('element-plus')
    const message = error instanceof Error ? error.message : '靶区预测失败'
    ElMessage.error(message.includes('GRID_LIMIT_EXCEEDED') ? '当前范围过大，请放大地图或增大网格尺寸' : '靶区预测失败，请稍后重试')
  } finally {
    prospectivityLoading.value = false
  }
}

// ---- 生命周期 ----
onMounted(async () => {
  document.addEventListener('keydown', handleMapKeydown)

  if (spatialTask.snapshot) await applySpatialTask(spatialTask.snapshot)

  if (!amapKey) {
    console.warn('[MapView] 缺少 VITE_AMAP_KEY，地图不可用')
    return
  }

  // 安全密钥（必须在加载前设置）
  if (amapSecret) {
    ;(window as any)._AMapSecurityConfig = { securityJsCode: amapSecret }
  }

  await nextTick()

  try {
    AMap = await AMapLoader.load({
      key: amapKey,
      version: '2.0',
      plugins: ['AMap.MouseTool'],
    })

    AMap.getConfig().appname = 'amap-jsapi-skill'

    if (!mapContainer.value) return

    map = new AMap.Map(mapContainer.value, {
      viewMode: '3D',
      zoom: 5,
      zooms: CHINA_MAP_ZOOM_RANGE,
      center: CHINA_MAP_CENTER,
      layers: [AMap.createDefaultLayer()],
    })
    applyChinaMapConstraints(AMap, map)
    appliedTaskId = ''
    if (spatialTask.snapshot) await applySpatialTask(spatialTask.snapshot)
  } catch (e) {
    console.error('[MapView] 地图加载失败:', e)
  }
})

onUnmounted(() => {
  document.removeEventListener('keydown', handleMapKeydown)
  stopActiveDrawing()
  stopTimelinePlayback()
  heatmap?.hide?.()
  map?.destroy?.()
})

watch(() => spatialTask.snapshot, (snapshot) => {
  if (!snapshot) return
  void applySpatialTask(snapshot)
}, { deep: true })

// ---- 地图功能栏 ----
const drawingToolIndexes = new Set([0, 2])

function stopActiveDrawing() {
  mouseTool?.close?.(false)
  mouseTool = null
  if (drawingToolIndexes.has(activeTool.value)) activeTool.value = -1
}

function finishDrawing(toolIndex: number) {
  mouseTool?.close?.(false)
  mouseTool = null
  if (activeTool.value === toolIndex) activeTool.value = -1
}

function handleMapKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape' && drawingToolIndexes.has(activeTool.value)) {
    stopActiveDrawing()
    activeFunction.value = null
  }
}

function closeActivePanel() {
  stopActiveDrawing()
  activeFunction.value = null
}

async function handleFunctionSelect(id: MapFunctionId) {
  if (activeFunction.value === id) {
    if (id === 'draw' || id === 'buffer') stopActiveDrawing()
    activeFunction.value = null
    return
  }

  stopActiveDrawing()
  activeFunction.value = id
  switch (id) {
    case 'query':
      await nextTick()
      spatialInput.value?.focus()
      break
    case 'draw':
      if (!map || !AMap) return
      activeTool.value = 0
      startDrawPolygon()
      break
    case 'buffer':
      if (!map || !AMap) return
      activeTool.value = 2
      startBufferAnalysis()
      break
    case 'heatmap':
      if (!heatmapVisible.value) await toggleHeatmap()
      break
    case 'prospectivity': {
      const currentQuery = spatialKeyword.value.trim() || spatialAnalysis.value?.interpretation.originalText.trim()
      if (currentQuery) prospectivityQuery.value = currentQuery
      break
    }
  }
}

// ── 绘制勘查区 + 自动空间查询 ──
let activePolygon: any = null

function startDrawPolygon() {
  if (!map || !AMap) return
  map.plugin(['AMap.MouseTool'], function () {
    if (activeTool.value !== 0) return
    mouseTool = new AMap.MouseTool(map)
    mouseTool.polygon({
      strokeColor: '#2E7D5B',
      strokeWeight: 2,
      strokeOpacity: 0.9,
      fillColor: '#2E7D5B',
      fillOpacity: 0.15,
    })
    mouseTool.on('draw', async (e: any) => {
      // 移除旧勘查区
      if (activePolygon) { activePolygon.remove(); drawnOverlays = drawnOverlays.filter(o => o !== activePolygon) }
      activePolygon = e.obj
      drawnOverlays.push(activePolygon)
      finishDrawing(0)

      // 用勘查区的外包范围过滤空间要素；当前空间查询接口的范围协议为 bbox。
      const kw = spatialKeyword.value.trim() || '东天山'
      try {
        const path = e.obj.getPath()
        const lngs = path.map((p: any) => Number(p.lng))
        const lats = path.map((p: any) => Number(p.lat))
        const bbox: [number, number, number, number] = [
          Math.min(...lngs), Math.min(...lats), Math.max(...lngs), Math.max(...lats),
        ]
        const result = await querySpatial({ question: kw, bbox, includeMock: true })
        const data = featuresToSpatialData(result.features)
        if (data?.markers?.length || data?.polylines?.length) {
          showSpatialData(data, result.source || 'none', result.analysis)
          // 弹出外包范围内的要素汇总
          const cx = lngs.reduce((a: number,b: number) => a+b, 0) / lngs.length
          const cy = lats.reduce((a: number,b: number) => a+b, 0) / lats.length
          new AMap.InfoWindow({
            content: `<div style="padding:8px 12px;font-size:12px"><b>勘查区外包范围</b><br/>搜索「${kw}」：${data.markers?.length || 0} 个点要素，${data.polylines?.length || 0} 条线要素</div>`,
            offset: [0, -20],
          }).open(map, [cx, cy])
        } else {
          const { ElMessage } = await import('element-plus')
          ElMessage.info('该勘查区外包范围内未查询到相关空间要素')
        }
      } catch {
        const { ElMessage } = await import('element-plus')
        ElMessage.error('勘查区空间查询失败')
      }
    })
  })
}

// ---- 缓冲区分析：绘制圆形后，由后端统一计算距离与筛选 ----
let activeBuffer: any = null

function startBufferAnalysis() {
  if (!map || !AMap) return
  map.plugin(['AMap.MouseTool'], () => {
    if (activeTool.value !== 2) return
    mouseTool = new AMap.MouseTool(map)
    mouseTool.circle({
      strokeColor: '#B8860B', strokeWeight: 2, strokeOpacity: 0.9,
      fillColor: '#B8860B', fillOpacity: 0.12,
    })
    mouseTool.on('draw', async (e: any) => {
      if (activeBuffer) {
        activeBuffer.remove()
        drawnOverlays = drawnOverlays.filter((overlay) => overlay !== activeBuffer)
      }
      activeBuffer = e.obj
      drawnOverlays.push(activeBuffer)
      finishDrawing(2)

      const center = activeBuffer.getCenter()
      const centerLng = Number(center.lng ?? center.getLng?.())
      const centerLat = Number(center.lat ?? center.getLat?.())
      const radius = Number(activeBuffer.getRadius())
      const keyword = spatialKeyword.value.trim() || '东天山'

      try {
        const result = await querySpatial({
          question: keyword,
          center: [centerLng, centerLat],
          radiusKm: radius / 1000,
          sortBy: 'distance',
          includeMock: true,
        })
        const data = featuresToSpatialData(result.features)
        showSpatialData(data, result.source || 'none', result.analysis)
        new AMap.InfoWindow({
          content: `<div style="padding:8px 12px;font-size:12px"><b>缓冲区分析</b><br/>半径 ${(radius / 1000).toFixed(2)} km，命中 ${data.markers?.length || 0} 个点要素、${data.polylines?.length || 0} 条线要素</div>`,
          offset: [0, -20],
        }).open(map, [centerLng, centerLat])
      } catch {
        const { ElMessage } = await import('element-plus')
        ElMessage.error('缓冲区分析失败')
      }
    })
  })
}

// ── 切换底图 ──
function toggleBaseMap() {
  if (!map || !AMap) return
  isSatellite.value = !isSatellite.value
  if (isSatellite.value) {
    map.setLayers([new AMap.TileLayer.Satellite()])
  } else {
    map.setLayers([AMap.createDefaultLayer()])
  }
}

// ── 清除覆盖物 ──
function clearAll() {
  spatialTask.clear()
  appliedTaskId = ''
  stopActiveDrawing()
  stopTimelinePlayback()
  selectedEra.value = null
  selectedRegion.value = null
  drawnOverlays.forEach(o => o.remove?.())
  drawnOverlays = []
  clearSpatialOverlays()
  clearGridState()
  heatmap?.hide?.()
  heatmapVisible.value = false
  currentSpatialData.value = { markers: [], polylines: [] }
  spatialSource.value = 'none'
  spatialAnalysis.value = null
  activePolygon = null
  activeBuffer = null
  activeTool.value = -1
  activeFunction.value = null
}
</script>

<template>
  <div class="map-layout">
    <MapFunctionRail
      :active-function="activeFunction"
      :heatmap-visible="heatmapVisible"
      :is-satellite="isSatellite"
      @select="handleFunctionSelect"
      @toggle-base="toggleBaseMap"
      @clear="clearAll"
    />

    <div class="map-workspace">
      <div class="map-body">
        <div class="map-container">
          <div v-if="!amapKey" class="placeholder">
            <div class="grid-bg" />
            <div class="placeholder-card">
              <div class="placeholder-title">高德地图</div>
              <div class="placeholder-desc">请配置 VITE_AMAP_KEY 环境变量</div>
            </div>
          </div>
          <div ref="mapContainer" class="map-el"></div>
          <div
            v-if="gridResult || (resultMode === 'score' && hasScores)"
            class="score-legend"
            :class="{ grid: gridResult }"
            aria-label="成矿有利度图例"
          >
            <strong>{{ gridResult ? '网格有利度' : '点位有利度' }}</strong>
            <span><i class="high" />高 ≥ 85</span>
            <span><i class="medium" />中 65–84</span>
            <span><i class="low" />低 &lt; 65</span>
          </div>
        </div>

        <aside v-if="activeFunction" class="analysis-panel" :aria-label="`${panelTitle}面板`">
          <ProspectivityPanel
            v-if="activeFunction === 'prospectivity'"
            v-model:query="prospectivityQuery"
            v-model:grid-size-km="prospectivityGridSize"
            v-model:minimum-score="prospectivityMinimumScore"
            :loading="prospectivityLoading"
            :result="gridResult"
            :selected-cell="selectedGridCell"
            @run="runProspectivityPrediction"
            @close="closeActivePanel"
            @select-target="focusGridTarget"
          />

          <template v-else>
            <header class="analysis-head">
              <div>
                <div class="analysis-kicker">空间分析</div>
                <h2>{{ panelTitle }}</h2>
              </div>
              <div class="analysis-actions">
                <button v-if="spatialAnalysis" class="export-btn" title="导出 GeoJSON" @click="exportGeoJson">
                  <Download aria-hidden="true" />GeoJSON
                </button>
                <button v-if="spatialAnalysis" class="export-btn" title="导出 CSV" @click="exportCsv">
                  <Download aria-hidden="true" />CSV
                </button>
                <button class="panel-close" title="关闭分析面板" aria-label="关闭分析面板" @click="closeActivePanel">
                  <Close aria-hidden="true" />
                </button>
              </div>
            </header>

            <div class="panel-search">
              <input ref="spatialInput" v-model="spatialKeyword" placeholder="区域、矿种、距离或年代条件" @keydown.enter="searchSpatial" />
              <button :disabled="spatialLoading || !spatialKeyword.trim()" @click="searchSpatial">
                {{ spatialLoading ? '查询中' : '查询' }}
              </button>
            </div>

            <div v-if="activeFunction === 'draw' || activeFunction === 'buffer' || activeFunction === 'heatmap'" class="function-status">
              <span>{{ activeFunction === 'draw' ? '勘查区状态' : activeFunction === 'buffer' ? '缓冲区状态' : '热力图状态' }}</span>
              <strong v-if="activeFunction === 'draw'">{{ activeTool === 0 ? '正在绘制' : activePolygon ? '已完成绘制' : '等待绘制' }}</strong>
              <strong v-else-if="activeFunction === 'buffer'">{{ activeTool === 2 ? '正在绘制' : activeBuffer ? '已完成分析' : '等待绘制' }}</strong>
              <button v-else @click="toggleHeatmap">{{ heatmapVisible ? '关闭热力图' : '显示热力图' }}</button>
            </div>

            <template v-if="spatialAnalysis">
              <div class="analysis-stats">
                <div><strong>{{ displayedSpatialData.markers?.length || 0 }}</strong><span>点要素</span></div>
                <div><strong>{{ displayedSpatialData.polylines?.length || 0 }}</strong><span>构造线</span></div>
                <div><strong>{{ displayedMockCount }}</strong><span>演示要素</span></div>
              </div>

              <div v-if="analysisConditions().length" class="analysis-conditions">
                <span v-for="condition in analysisConditions()" :key="condition">{{ condition }}</span>
              </div>

              <section v-if="activeFunction === 'compare' && regionSummaries.length" class="region-comparison" aria-label="区域对比">
                <header class="region-comparison-head">
                  <span>区域对比</span>
                  <button :class="{ active: selectedRegion === null }" @click="selectRegion(null)">全部区域</button>
                </header>
                <div class="region-table-head"><span>区域</span><span>点数</span><span>均分</span><span>高分</span></div>
                <button
                  v-for="region in regionSummaries"
                  :key="region.region"
                  class="region-row"
                  :class="{ active: selectedRegion === region.region }"
                  @click="selectRegion(region.region)"
                >
                  <span class="region-name"><strong>{{ region.region }}</strong><small>{{ region.dominantEra || '年代未知' }} · 构造 {{ region.structureCount }}</small></span>
                  <span>{{ region.count }}</span><span>{{ region.averageProspectivityScore ?? '—' }}</span><span>{{ region.highProspectivityCount }}</span>
                </button>
              </section>

              <section v-if="activeFunction === 'timeline' && temporalBuckets.length" class="temporal-section" aria-label="成矿年代轴">
                <header class="temporal-head">
                  <div><span>年代证据</span><strong>{{ selectedEra || '全部时期' }}</strong></div>
                  <button class="timeline-play" :title="timelinePlaying ? '暂停年代播放' : '播放年代序列'" @click="toggleTimelinePlayback">
                    <span v-if="!timelinePlaying">▶</span><span v-else>Ⅱ</span>
                  </button>
                </header>
                <div class="timeline-track">
                  <button :class="{ active: selectedEra === null }" @click="selectEra(null)"><span>全部</span><strong>{{ regionMarkers.length }}</strong></button>
                  <button v-for="bucket in temporalBuckets" :key="bucket.era" :class="{ active: selectedEra === bucket.era }" @click="selectEra(bucket.era)">
                    <span>{{ bucket.era }}</span><strong>{{ bucket.count }}</strong>
                  </button>
                </div>
                <div class="timeline-meta"><span>{{ temporalBuckets.length }} 个年代</span><span v-if="regionUnknownEraCount">{{ regionUnknownEraCount }} 个缺少年代</span></div>
              </section>

              <section v-if="visibleProspectivity.top && ['query', 'heatmap'].includes(activeFunction)" class="prospectivity-summary">
                <div class="prospectivity-topline"><span>有利度最高</span><strong>{{ visibleProspectivity.top.prospectivity?.score }} 分</strong></div>
                <div class="prospectivity-name">{{ visibleProspectivity.top.name }}</div>
                <div class="prospectivity-distribution"><span class="high">高 {{ visibleProspectivity.high }}</span><span class="medium">中 {{ visibleProspectivity.medium }}</span><span class="low">低 {{ visibleProspectivity.low }}</span></div>
              </section>

              <div v-if="visibleNearest && ['query', 'draw', 'buffer'].includes(activeFunction)" class="nearest-result">
                <span>最近结果</span><strong>{{ visibleNearest.name }}</strong><em>{{ visibleNearest.distanceKm?.toFixed(2) }} km</em>
              </div>

              <div v-if="hasScores && ['query', 'draw', 'buffer'].includes(activeFunction)" class="result-mode">
                <button :class="{ active: resultMode === 'query' }" @click="setResultMode('query')">查询顺序</button>
                <button :class="{ active: resultMode === 'score' }" @click="setResultMode('score')">有利度</button>
              </div>

              <div v-if="rankedResults.length && ['query', 'draw', 'buffer'].includes(activeFunction)" class="ranked-list">
                <button v-for="(item, index) in rankedResults" :key="item.id" @click="focusResult(item)">
                  <span class="rank-index">{{ String(index + 1).padStart(2, '0') }}</span>
                  <span class="rank-name"><strong>{{ item.name }}</strong><small>{{ item.region || item.type }}</small></span>
                  <span v-if="resultMode === 'score' && item.prospectivity" class="score-badge" :class="item.prospectivity.level">{{ item.prospectivity.score }}</span>
                  <span v-else-if="item.distanceKm !== undefined" class="rank-distance">{{ item.distanceKm.toFixed(1) }} km</span>
                </button>
                <div v-if="resultOverflow" class="result-overflow">另有 {{ resultOverflow }} 个点要素已显示在地图中</div>
              </div>

              <p v-if="spatialAnalysis.warnings.length" class="analysis-warning">{{ spatialAnalysis.warnings[spatialAnalysis.warnings.length - 1] }}</p>
            </template>

            <div v-else class="panel-empty"><strong>暂无分析结果</strong><span>{{ activeFunction === 'draw' || activeFunction === 'buffer' ? '等待地图绘制' : '等待空间查询' }}</span></div>
          </template>
        </aside>
      </div>

      <footer class="map-statusbar">
        <span v-if="spatialSource !== 'none'" class="source-status" :class="spatialSource">{{ sourceLabel() }}</span>
        <span>{{ amapKey ? '高德地图 JSAPI v2.0' : '地图 API Key 未配置' }}</span>
      </footer>
    </div>
  </div>
</template>

<style scoped>
.map-layout { display: flex; height: 100%; min-height: 0; }
.map-workspace { display: flex; flex: 1; flex-direction: column; min-width: 0; min-height: 0; }
.map-body { display: flex; flex: 1; min-width: 0; min-height: 0; }

.map-container { position: relative; flex: 1; min-width: 0; background: var(--color-bg-subtle); overflow: hidden; }
.map-el { position: absolute; inset: 0; }

.analysis-panel {
  position: relative;
  z-index: 5;
  width: 390px;
  max-width: 38%;
  flex-shrink: 0;
  overflow: auto;
  border-left: 1px solid var(--color-ink-100);
  background: var(--color-bg);
}
.analysis-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; padding: 15px 16px 12px; border-bottom: 1px solid var(--color-ink-100); }
.analysis-kicker { color: var(--color-primary); font-size: 10px; font-weight: 600; letter-spacing: 0.06em; }
.analysis-head h2 { margin: 2px 0 0; color: var(--color-ink-900); font-family: var(--font-display); font-size: 16px; font-weight: 600; letter-spacing: 0; }
.analysis-actions { display: flex; align-items: center; gap: 2px; }
.export-btn { display: inline-flex; align-items: center; gap: 3px; height: 28px; padding: 0 6px; border: 1px solid transparent; background: transparent; color: var(--color-ink-500); font-family: var(--font-body); font-size: 9px; cursor: pointer; }
.export-btn svg { width: 12px; height: 12px; flex-shrink: 0; }
.export-btn:hover, .export-btn:focus-visible { color: var(--color-primary); border-color: var(--color-ink-100); outline: none; }
.export-btn.suggested { border-color: var(--color-accent); background: var(--color-accent-light); color: var(--color-accent); font-weight: 600; }
.panel-close { display: flex; align-items: center; justify-content: center; width: 28px; height: 28px; border: 1px solid transparent; background: transparent; color: var(--color-ink-500); cursor: pointer; }
.panel-close svg { width: 15px; height: 15px; }
.panel-close:hover, .panel-close:focus-visible { color: var(--color-ink-900); border-color: var(--color-ink-100); outline: none; }
.panel-search { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 5px; padding: 12px 16px; border-bottom: 1px solid var(--color-ink-100); }
.panel-search input { min-width: 0; height: 34px; padding: 0 9px; border: 1px solid var(--color-ink-100); border-radius: var(--radius-md); background: var(--color-bg); color: var(--color-ink-900); font: 11px var(--font-body); outline: none; }
.panel-search input:focus { border-color: var(--color-primary); }
.panel-search button { min-width: 58px; border: 1px solid var(--color-primary); border-radius: var(--radius-md); background: var(--color-primary); color: #fff; font: 600 11px var(--font-body); cursor: pointer; }
.panel-search button:hover:not(:disabled) { background: var(--color-primary-hover); }
.panel-search button:disabled { opacity: 0.45; cursor: not-allowed; }
.function-status { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 10px 16px; border-bottom: 1px solid var(--color-ink-100); background: var(--color-bg-subtle); }
.function-status > span { color: var(--color-ink-300); font-size: 10px; }
.function-status > strong { color: var(--color-primary); font-size: 11px; }
.function-status > button { min-height: 28px; padding: 3px 9px; border: 1px solid var(--color-primary); border-radius: var(--radius-md); background: var(--color-surface); color: var(--color-primary); font: 10px var(--font-body); cursor: pointer; }
.analysis-stats { display: grid; grid-template-columns: repeat(3, 1fr); padding: 11px 16px; border-bottom: 1px solid var(--color-ink-50); }
.analysis-stats div { display: flex; flex-direction: column; gap: 2px; border-left: 1px solid var(--color-ink-100); padding-left: 10px; }
.analysis-stats div:first-child { border-left: 0; padding-left: 0; }
.analysis-stats strong { color: var(--color-ink-900); font-family: var(--font-display); font-size: 20px; line-height: 1.1; }
.analysis-stats span { color: var(--color-ink-300); font-size: 10px; }
.analysis-conditions { display: flex; flex-direction: column; gap: 3px; padding: 9px 16px; color: var(--color-ink-500); font-size: 11px; border-bottom: 1px solid var(--color-ink-50); }
.region-comparison { padding: 10px 16px; border-bottom: 1px solid var(--color-ink-100); }
.region-comparison-head { display: flex; align-items: center; justify-content: space-between; gap: 10px; margin-bottom: 6px; }
.region-comparison-head > span { color: var(--color-ink-900); font-family: var(--font-display); font-size: 12px; font-weight: 600; }
.region-comparison-head button { min-height: 25px; padding: 3px 7px; border: 1px solid var(--color-ink-100); background: var(--color-surface); color: var(--color-ink-500); font-family: var(--font-body); font-size: 9px; cursor: pointer; }
.region-comparison-head button:hover { border-color: var(--color-accent); color: var(--color-accent); }
.region-comparison-head button.active { border-color: var(--color-accent); background: var(--color-accent-light); color: var(--color-accent); }
.region-table-head, .region-row { display: grid; grid-template-columns: minmax(112px, 1fr) 38px 38px 38px; gap: 5px; align-items: center; }
.region-table-head { padding: 4px 6px; background: var(--color-bg-subtle); color: var(--color-ink-300); font-size: 9px; text-align: right; }
.region-table-head span:first-child { text-align: left; }
.region-row { width: 100%; padding: 7px 6px; border: 0; border-bottom: 1px solid var(--color-ink-50); background: transparent; color: var(--color-ink-500); font-family: var(--font-body); font-size: 10px; text-align: right; cursor: pointer; }
.region-row:hover, .region-row:focus-visible { background: var(--color-accent-light); color: var(--color-accent); outline: none; }
.region-row.active { background: var(--color-accent-light); color: var(--color-accent); }
.region-name { display: flex; flex-direction: column; gap: 1px; min-width: 0; text-align: left; }
.region-name strong { color: var(--color-ink-700); font-size: 10px; overflow-wrap: anywhere; }
.region-row.active .region-name strong { color: var(--color-accent); }
.region-name small { color: var(--color-ink-300); font-size: 8px; overflow-wrap: anywhere; }
.temporal-section { padding: 10px 16px; border-bottom: 1px solid var(--color-ink-100); }
.temporal-head { display: flex; align-items: center; justify-content: space-between; gap: 10px; margin-bottom: 7px; }
.temporal-head > div { display: flex; flex-direction: column; gap: 1px; min-width: 0; }
.temporal-head span { color: var(--color-ink-300); font-size: 10px; }
.temporal-head strong { color: var(--color-ink-900); font-family: var(--font-display); font-size: 12px; overflow-wrap: anywhere; }
.timeline-play { display: flex; align-items: center; justify-content: center; width: 28px; height: 28px; flex-shrink: 0; border: 1px solid var(--color-ink-100); background: var(--color-surface); color: var(--color-primary); cursor: pointer; }
.timeline-play:hover, .timeline-play:focus-visible { border-color: var(--color-primary); outline: none; }
.timeline-play svg { width: 13px; height: 13px; }
.timeline-track { display: flex; gap: 4px; overflow-x: auto; padding: 1px 1px 6px; scrollbar-width: thin; scrollbar-color: var(--color-ink-200) transparent; }
.timeline-track button { display: flex; flex-direction: column; justify-content: space-between; gap: 4px; min-width: 68px; min-height: 45px; padding: 6px 7px; border: 1px solid var(--color-ink-100); background: var(--color-surface); color: var(--color-ink-500); text-align: left; cursor: pointer; font-family: var(--font-body); }
.timeline-track button:hover { border-color: var(--color-primary); color: var(--color-primary); }
.timeline-track button.active { border-color: var(--color-primary); background: var(--color-primary-light); color: var(--color-primary); }
.timeline-track button span { font-size: 10px; white-space: nowrap; }
.timeline-track button strong { font-family: var(--font-display); font-size: 14px; }
.timeline-meta { display: flex; justify-content: space-between; gap: 10px; color: var(--color-ink-300); font-size: 9px; }
.prospectivity-summary { padding: 10px 16px; border-bottom: 1px solid var(--color-ink-100); }
.prospectivity-topline { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; color: var(--color-ink-300); font-size: 10px; }
.prospectivity-topline strong { color: var(--color-primary); font-family: var(--font-display); font-size: 17px; }
.prospectivity-name { margin-top: 2px; color: var(--color-ink-900); font-size: 11px; font-weight: 600; overflow-wrap: anywhere; }
.prospectivity-distribution { display: grid; grid-template-columns: repeat(3, 1fr); gap: 5px; margin-top: 8px; }
.prospectivity-distribution span { padding: 4px 5px; border: 1px solid var(--color-ink-100); font-size: 10px; text-align: center; }
.prospectivity-distribution .high { color: var(--color-primary); background: var(--color-primary-light); }
.prospectivity-distribution .medium { color: #7A5810; background: var(--color-warning-light); }
.prospectivity-distribution .low { color: var(--color-danger); background: var(--color-danger-light); }
.nearest-result { display: grid; grid-template-columns: 1fr auto; gap: 2px 10px; padding: 9px 16px; border-bottom: 1px solid var(--color-ink-100); }
.nearest-result span { grid-column: 1 / -1; color: var(--color-ink-300); font-size: 10px; }
.nearest-result strong { min-width: 0; color: var(--color-ink-900); font-size: 12px; overflow-wrap: anywhere; }
.nearest-result em { color: var(--color-primary); font-size: 11px; font-style: normal; white-space: nowrap; }
.result-mode { display: grid; grid-template-columns: 1fr 1fr; margin: 9px 16px 2px; border: 1px solid var(--color-ink-100); }
.result-mode button { min-height: 28px; border: 0; border-left: 1px solid var(--color-ink-100); background: var(--color-surface); color: var(--color-ink-500); font-family: var(--font-body); font-size: 10px; cursor: pointer; }
.result-mode button:first-child { border-left: 0; }
.result-mode button:hover { color: var(--color-primary); }
.result-mode button.active { background: var(--color-primary-light); color: var(--color-primary); font-weight: 600; }
.ranked-list { display: flex; flex-direction: column; padding: 0 16px; }
.ranked-list > button { display: grid; grid-template-columns: 24px minmax(0, 1fr) auto; gap: 8px; align-items: center; width: 100%; padding: 8px 0; border: 0; border-bottom: 1px solid var(--color-ink-50); background: transparent; text-align: left; cursor: pointer; font-family: var(--font-body); }
.ranked-list > button:hover, .ranked-list > button:focus-visible { background: var(--color-primary-ghost); outline: none; }
.rank-index { color: var(--color-ink-300); font-family: var(--font-display); font-size: 11px; }
.rank-name { display: flex; flex-direction: column; gap: 1px; min-width: 0; }
.rank-name strong { color: var(--color-ink-700); font-size: 11px; font-weight: 600; overflow-wrap: anywhere; }
.rank-name small { color: var(--color-ink-300); font-size: 9px; overflow-wrap: anywhere; }
.rank-distance { color: var(--color-accent); font-size: 10px; white-space: nowrap; }
.score-badge { min-width: 30px; padding: 2px 4px; border: 1px solid currentColor; font-size: 10px; text-align: center; }
.score-badge.high { color: var(--color-primary); background: var(--color-primary-light); }
.score-badge.medium { color: #7A5810; background: var(--color-warning-light); }
.score-badge.low { color: var(--color-danger); background: var(--color-danger-light); }
.result-overflow { padding: 8px 0 2px; color: var(--color-ink-300); font-size: 10px; text-align: center; }
.analysis-warning { margin: 10px 16px 14px; padding-top: 9px; border-top: 1px solid var(--color-warning); color: #7A5810; font-size: 10px; line-height: 1.55; text-wrap: pretty; }
.panel-empty { display: flex; flex-direction: column; align-items: center; justify-content: center; min-height: 180px; color: var(--color-ink-300); }
.panel-empty strong { color: var(--color-ink-700); font-family: var(--font-display); font-size: 14px; }
.panel-empty span { margin-top: 3px; font-size: 10px; }
.score-legend { position: absolute; z-index: 4; left: 16px; bottom: 16px; display: flex; flex-direction: column; gap: 5px; padding: 9px 11px; border: 1px solid var(--color-ink-100); background: rgba(254, 253, 249, 0.94); box-shadow: var(--shadow-sm); color: var(--color-ink-500); font-size: 10px; backdrop-filter: blur(6px); }
.score-legend strong { color: var(--color-ink-900); font-family: var(--font-display); font-size: 11px; }
.score-legend span { display: flex; align-items: center; gap: 6px; }
.score-legend i { width: 8px; height: 8px; border: 1px solid #fff; box-shadow: 0 0 0 1px var(--color-ink-100); }
.score-legend i.high { background: var(--color-primary); }
.score-legend i.medium { background: var(--color-warning); }
.score-legend i.low { background: var(--color-danger); }
.score-legend.grid i.high { background: var(--color-danger); }
.score-legend.grid i.low { background: var(--color-primary); }

/* 占位样式（API Key 未配置时） */
.placeholder { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; z-index: 10; }
.grid-bg {
  position: absolute; inset: 0;
  background-image:
    linear-gradient(var(--color-ink-50) 1px, transparent 1px),
    linear-gradient(90deg, var(--color-ink-50) 1px, transparent 1px);
  background-size: 40px 40px;
}
.placeholder-card {
  position: relative; z-index: 1; text-align: center;
  background: var(--color-surface); padding: 24px 32px;
  border: 1px solid var(--color-ink-100);
}
.placeholder-title { font-family: var(--font-display); font-size: 15px; font-weight: 600; color: var(--color-ink-900); margin-bottom: 4px; }
.placeholder-desc { font-size: 12px; color: var(--color-ink-500); }

.map-statusbar { display: flex; align-items: center; justify-content: flex-end; gap: 8px; min-height: 28px; padding: 4px 12px; border-top: 1px solid var(--color-ink-100); background: var(--color-surface); color: var(--color-ink-300); font-size: 9px; }
.source-status { font-size: 11px; padding: 3px 7px; border: 1px solid var(--color-ink-100); color: var(--color-ink-500); }
.source-status.neo4j { color: var(--color-primary); border-color: var(--color-primary); }
.source-status.mock { color: #9A6514; border-color: #B8860B; background: #FFF8E8; }
.source-status.mixed { color: var(--color-accent); border-color: var(--color-accent); background: var(--color-accent-light); }

@media (max-width: 1180px) {
  .analysis-panel { width: 350px; max-width: 42%; }
}

@media (max-width: 720px) {
  .map-layout { flex-direction: column; }
  .map-body { flex-direction: column; }
  .map-container { min-height: 48%; }
  .analysis-panel { width: 100%; max-width: none; max-height: 48%; border-top: 1px solid var(--color-ink-100); border-left: 0; }
  .score-legend { left: 10px; bottom: 10px; }
  .map-statusbar { min-height: 24px; }
}
</style>
