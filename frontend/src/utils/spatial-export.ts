import type { SpatialData } from '@/types'

export function spatialExportFilename(extension: 'geojson' | 'csv', date = new Date()): string {
  const stamp = date.toISOString().slice(0, 16).replaceAll(/[-:T]/g, '')
  return `空间分析结果-${stamp}.${extension}`
}

export function spatialDataToGeoJson(data: SpatialData): string {
  const features = [
    ...(data.markers || []).map((marker) => {
      const { lng, lat, ...properties } = marker
      return { type: 'Feature', geometry: { type: 'Point', coordinates: [lng, lat] }, properties }
    }),
    ...(data.polylines || []).map((line) => {
      const { path, ...properties } = line
      return { type: 'Feature', geometry: { type: 'LineString', coordinates: path }, properties }
    }),
  ]
  return JSON.stringify({ type: 'FeatureCollection', features }, null, 2)
}

function csvCell(value: unknown): string {
  let text = typeof value === 'object' && value !== null ? JSON.stringify(value) : String(value ?? '')
  if (/^[=+\-@]/.test(text)) text = `'${text}`
  return `"${text.replaceAll('"', '""')}"`
}

export function spatialDataToCsv(data: SpatialData): string {
  const header = ['要素类型', '名称', '实体类型', '经度', '纬度', '坐标路径', '区域', '矿种', '年代', '成因', '距参照km', '距构造km', '有利度', '等级', '数据来源', '证据']
  const pointRows = (data.markers || []).map((marker) => [
    'Point', marker.name, marker.type, marker.lng, marker.lat, '', marker.region,
    marker.mineralKind, marker.era, marker.depositType, marker.distanceKm,
    marker.nearestStructureKm, marker.prospectivity?.score, marker.prospectivity?.level,
    marker.isMock ? 'mock' : 'neo4j', marker.evidence,
  ])
  const lineRows = (data.polylines || []).map((line) => [
    'LineString', line.label || line.id, line.type, '', '', line.path, line.region,
    '', '', '', line.distanceKm, '', '', '', line.isMock ? 'mock' : 'neo4j', line.evidence,
  ])
  const csv = [header, ...pointRows, ...lineRows]
    .map((row) => row.map(csvCell).join(','))
    .join('\r\n')
  return `\uFEFF${csv}`
}
