import assert from 'node:assert/strict'
import { spatialDataToCsv, spatialDataToGeoJson, spatialExportFilename } from './spatial-export'
import { filterSpatialData, filterSpatialDataByEra, markerHasEra } from './spatial-temporal'

const data = {
  markers: [{
    id: 'm-1', name: '=演示矿点', type: 'Mineral', lng: 101.72, lat: 26.56,
    region: '攀西钒钛成矿带', era: '晚二叠世 / 海西期', isMock: true,
    prospectivity: { score: 88.5, level: 'high' as const, model: 'demo-v1' as const, factors: [] },
  }],
  polylines: [{ id: 'f-1', type: 'Structure', label: '演示断裂', path: [[101, 26], [102, 27]] as Array<[number, number]>, region: '攀西钒钛成矿带', isMock: true }],
}

const geojson = JSON.parse(spatialDataToGeoJson(data))
assert.equal(geojson.type, 'FeatureCollection')
assert.equal(geojson.features.length, 2)
assert.deepEqual(geojson.features[0].geometry.coordinates, [101.72, 26.56])
assert.equal(geojson.features[0].properties.prospectivity.score, 88.5)

assert.equal(markerHasEra(data.markers[0]!, '晚二叠世'), true)
assert.equal(markerHasEra(data.markers[0]!, '燕山期'), false)
assert.equal(filterSpatialDataByEra(data, '海西期').markers.length, 1)
assert.equal(filterSpatialDataByEra(data, '燕山期').markers.length, 0)
assert.equal(filterSpatialDataByEra(data, '燕山期').polylines.length, 1)
assert.equal(filterSpatialData(data, { region: '攀西钒钛成矿带' }).markers.length, 1)
assert.equal(filterSpatialData(data, { region: '攀西钒钛成矿带' }).polylines.length, 1)
assert.equal(filterSpatialData(data, { region: '东天山成矿带' }).markers.length, 0)
assert.equal(filterSpatialData(data, { region: '东天山成矿带' }).polylines.length, 0)
assert.equal(filterSpatialData(data, { region: '攀西钒钛成矿带', era: '海西期' }).markers.length, 1)
assert.equal(filterSpatialData(data, { region: '攀西钒钛成矿带', era: '燕山期' }).markers.length, 0)

const csv = spatialDataToCsv(data)
assert.ok(csv.startsWith('\uFEFF'))
assert.ok(csv.includes("'=演示矿点"))
assert.ok(csv.includes('88.5'))

assert.equal(
  spatialExportFilename('geojson', new Date('2026-07-13T10:20:00.000Z')),
  '空间分析结果-202607131020.geojson',
)

console.log('[PASS] spatial export: GeoJSON + CSV')
