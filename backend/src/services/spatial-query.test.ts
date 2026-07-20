import assert from 'node:assert/strict'
import { MOCK_SPATIAL_STATS, matchMockSpatial } from '../data/spatial-mock.js'
import { analyzeSpatialQuery, geologicalEraOrder, splitGeologicalEras } from './spatial.js'
import { parseSpatialQuestion } from './spatial-query.js'

assert.equal(MOCK_SPATIAL_STATS.regions, 10)
assert.ok(MOCK_SPATIAL_STATS.totalFeatures >= 1300)
assert.ok(MOCK_SPATIAL_STATS.mineralPoints >= 1000)

const panxi = matchMockSpatial('四川攀枝花地区钒钛磁铁矿分布')
assert.ok(panxi.markers.length >= 100)
assert.ok(panxi.markers.every((point) => point.region === '攀西钒钛成矿带'))
assert.ok(panxi.markers.every((point) => point.isMock === true))

const weiyaRocks = await analyzeSpatialQuery({ keyword: '尾亚', entityTypes: ['Rock'] })
assert.ok(weiyaRocks.data.markers.length > 0)
assert.ok(weiyaRocks.data.markers.every((point) => point.type === 'Rock'))
assert.ok(weiyaRocks.data.markers.every((point) => point.name.includes('尾亚')))

const weiyaBbox = await analyzeSpatialQuery({ keyword: '尾亚', bbox: [93.45, 41.45, 93.55, 41.55] })
assert.ok(weiyaBbox.data.markers.length > 0)
assert.ok(weiyaBbox.data.markers.every((point) => point.lng >= 93.45 && point.lng <= 93.55))

const parsed = parseSpatialQuestion('查询东天山断裂带 10 千米范围内，形成于海西期的铁矿，并按距离排序')
assert.equal(parsed.anchorName, '东天山断裂带')
assert.equal(parsed.radiusKm, 10)
assert.deepEqual(parsed.timePeriods, ['海西期'])
assert.equal(parsed.sortBy, 'distance')

const gridParsed = parseSpatialQuestion('用10公里网格预测攀西钒钛磁铁矿靶区')
assert.equal(gridParsed.spatialIntent, true)
assert.equal(gridParsed.anchorName, undefined)
assert.equal(gridParsed.radiusKm, undefined)
const gridAnalysis = await analyzeSpatialQuery({ question: gridParsed.originalText, includeMock: true })
assert.ok(gridAnalysis.data.markers.length > 0)

const analysis = await analyzeSpatialQuery({ question: parsed.originalText })
assert.ok(analysis.analysis.summary.pointCount > 0)
assert.ok(analysis.analysis.summary.nearestDistanceKm! <= 10)
assert.ok(analysis.data.markers.every((point) => point.distanceKm! <= 10))
assert.ok(analysis.data.markers.every((point) => point.owlTypes?.includes('AgeConstrainedMineral')))

const prospectivity = await analyzeSpatialQuery({
  question: '分析攀枝花地区钒钛磁铁矿成矿有利度并优选靶区',
})
assert.equal(prospectivity.analysis.interpretation.sortBy, 'score')
assert.ok(prospectivity.analysis.summary.highProspectivityCount > 0)
assert.ok(prospectivity.analysis.summary.mediumProspectivityCount > 0)
assert.ok(prospectivity.analysis.summary.lowProspectivityCount > 0)
assert.equal(
  prospectivity.analysis.summary.highProspectivityCount +
    prospectivity.analysis.summary.mediumProspectivityCount +
    prospectivity.analysis.summary.lowProspectivityCount,
  prospectivity.analysis.summary.pointCount,
)
const scored = prospectivity.data.markers.filter((point) => point.prospectivity)
assert.ok(scored.every((point, index) => index === 0 || scored[index - 1]!.prospectivity!.score >= point.prospectivity!.score))
assert.ok(scored.every((point) =>
  point.prospectivity!.score === Number(
    point.prospectivity!.factors.reduce((sum, factor) => sum + factor.score, 0).toFixed(1),
  ),
))

assert.deepEqual(splitGeologicalEras('晚二叠世 / 海西期'), ['晚二叠世', '海西期'])
assert.ok(geologicalEraOrder('太古宙') < geologicalEraOrder('晚二叠世'))
assert.ok(geologicalEraOrder('晚二叠世') < geologicalEraOrder('燕山期'))
assert.ok(geologicalEraOrder('燕山期') < geologicalEraOrder('喜山期'))

const temporal = await analyzeSpatialQuery({ question: '查看全国矿产时空演化' })
assert.ok(temporal.analysis.temporal.buckets.length >= 8)
assert.ok(temporal.analysis.temporal.buckets.every((bucket, index) =>
  index === 0 || temporal.analysis.temporal.buckets[index - 1]!.order <= bucket.order,
))
assert.ok(temporal.analysis.temporal.buckets.every((bucket) =>
  bucket.centroid[0] >= 73.5 && bucket.centroid[0] <= 135.1 &&
  bucket.centroid[1] >= 3.5 && bucket.centroid[1] <= 53.6,
))
assert.equal(
  temporal.analysis.temporal.buckets.reduce((sum, bucket) => sum + bucket.count, 0),
  temporal.analysis.summary.pointCount,
)

const comparison = await analyzeSpatialQuery({
  question: '对比攀西和东天山的钒钛磁铁矿有利度',
})
assert.deepEqual(comparison.analysis.interpretation.mineralKinds, ['钒钛磁铁矿'])
assert.deepEqual(
  comparison.analysis.regions.map((region) => region.region),
  ['攀西钒钛成矿带', '东天山成矿带'],
)
assert.equal(
  comparison.analysis.regions.reduce((sum, region) => sum + region.count, 0),
  comparison.analysis.summary.pointCount,
)
assert.ok(comparison.analysis.regions.every((region) =>
  region.averageProspectivityScore! >= 0 && region.averageProspectivityScore! <= 100 &&
  region.maxProspectivityScore! >= region.averageProspectivityScore! &&
  region.structureCount > 0 && region.dominantMineralKind === '钒钛磁铁矿' &&
  region.bbox[0] >= 73.5 && region.bbox[2] <= 135.1 &&
  region.bbox[1] >= 3.5 && region.bbox[3] <= 53.6,
))
assert.ok(comparison.data.markers.every((marker) => marker.mineralKind === 'FeTi'))

console.log(`[PASS] spatial mock: ${MOCK_SPATIAL_STATS.totalFeatures} features across ${MOCK_SPATIAL_STATS.regions} regions`)
console.log(`[PASS] natural-language analysis: ${analysis.analysis.summary.pointCount} points within 10 km`)
console.log(`[PASS] prospectivity demo: ${prospectivity.analysis.summary.highProspectivityCount} high-priority points`)
console.log(`[PASS] temporal evolution: ${temporal.analysis.temporal.buckets.length} ordered eras`)
console.log(`[PASS] regional comparison: ${comparison.analysis.regions.length} regions`)
