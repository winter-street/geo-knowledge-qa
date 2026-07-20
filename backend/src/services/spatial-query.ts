import type { GeoEntityType, SpatialQueryInterpretation } from '../types/index.js'

const MINERAL_TERMS: Array<[string, string[]]> = [
  ['钒钛磁铁矿', ['钒钛', '钒钛磁铁', '钛磁铁', '钛铁矿']],
  ['铁矿', ['铁矿', '赤铁矿']],
  ['铜镍矿', ['铜镍', '镍矿', '镍黄铁矿', '磁黄铁矿']],
  ['铜矿', ['铜矿', '铜铁', '黄铜矿']],
  ['金矿', ['金矿']],
  ['钼矿', ['钼矿', '钼']],
  ['钨矿', ['钨矿', '钨']],
  ['锡矿', ['锡矿', '锡']],
  ['铅锌矿', ['铅锌', '铅矿', '锌矿']],
  ['铬铁矿', ['铬铁矿', '铬矿']],
  ['稀土矿', ['稀土']],
]

const TIME_PERIODS = [
  '太古宙', '元古代', '中元古代', '新元古代', '古生代', '晚古生代',
  '石炭纪', '二叠纪', '早二叠世', '晚二叠世', '三叠纪', '侏罗纪',
  '白垩纪', '古近纪', '加里东期', '海西期', '华力西期', '印支期',
  '燕山期', '喜山期',
]

const DEPOSIT_TYPES = [
  '岩浆分异型', '岩浆熔离型', '岩浆热液型', '矽卡岩型', '斑岩型',
  '热液脉型', '石英脉型', '剪切带型', '沉积变质型', '火山沉积变质型',
  '层控型', '卡林型', '微细浸染型', '蚀变岩型',
]

function unique<T>(values: T[]): T[] {
  return Array.from(new Set(values))
}

function withoutGridSize(text: string): string {
  return text.replace(/\d+(?:\.\d+)?\s*(?:公里|千米|km|KM|米|m)\s*网格/g, '网格')
}

function parseRadiusKm(text: string): number | undefined {
  const match = withoutGridSize(text).match(/(\d+(?:\.\d+)?)\s*(公里|千米|km|KM|米|m)\s*(?:范围内|内|以内|缓冲区|附近|周边)?/)
  if (!match) return undefined
  const value = Number(match[1])
  if (!Number.isFinite(value) || value <= 0) return undefined
  return match[2] === '米' || match[2] === 'm' ? value / 1000 : value
}

function parseAnchorName(text: string): string | undefined {
  const normalized = withoutGridSize(text)
  const radiusAnchor = normalized.match(/(?:查询|查找|筛选|分析|显示|寻找)?\s*([^，。；;]{2,36}?)\s*(?:周边|附近|方圆|\d+(?:\.\d+)?\s*(?:公里|千米|km|KM|米|m)\s*(?:范围内|内|以内|缓冲区)?)/)
  const nearestAnchor = normalized.match(/(?:距离|离)\s*([^，。；;]{2,30}?)\s*(?:最近|由近到远|的)/)
  const raw = radiusAnchor?.[1] || nearestAnchor?.[1]
  if (!raw) return undefined
  const cleaned = raw
    .replace(/^(请|帮我|查询|查找|筛选|分析|显示|寻找)+/, '')
    .replace(/(范围|区域|一带)$/, '')
    .trim()
  return cleaned.length >= 2 ? cleaned : undefined
}

function inferEntityTypes(text: string): GeoEntityType[] {
  const types: GeoEntityType[] = []
  if (/(矿产|矿床|矿点|矿化|铁矿|铜矿|金矿|钼矿|钨矿|锡矿|铅锌|稀土)/.test(text)) types.push('Mineral')
  if (/(岩石|岩体|围岩|母岩|辉长岩|玄武岩|花岗岩|闪长岩|片麻岩|白云岩)/.test(text)) types.push('Rock')
  if (/(断裂|构造|断层|剪切带|缝合带|造山带)/.test(text)) types.push('Structure')
  if (/(地区|区域|成矿带)/.test(text) && types.length === 0) types.push('Region')
  return unique(types.length ? types : ['Mineral', 'Rock', 'Structure'])
}

export function parseSpatialQuestion(text: string): SpatialQueryInterpretation {
  const originalText = String(text || '').trim()
  const radiusKm = parseRadiusKm(originalText)
  let mineralKinds = MINERAL_TERMS
    .filter(([, terms]) => terms.some((term) => originalText.includes(term)))
    .map(([label]) => label)
  if (mineralKinds.includes('钒钛磁铁矿')) {
    const remaining = originalText.replace(/钒钛磁铁矿|钒钛磁铁|钛磁铁矿|钛磁铁|钛铁矿/g, '')
    if (!remaining.includes('铁矿')) mineralKinds = mineralKinds.filter((kind) => kind !== '铁矿')
  }
  const timePeriods = TIME_PERIODS.filter((term) => originalText.includes(term))
  const depositTypes = DEPOSIT_TYPES.filter((term) => originalText.includes(term))
  const owlTypes: string[] = []
  if (/(受.*构造.*控制|构造控矿|断裂控矿|受控于)/.test(originalText)) owlTypes.push('StructurallyControlledMineral')
  if (/(赋存于|赋矿|围岩|母岩|容矿岩石)/.test(originalText)) owlTypes.push('RockHostedMineral')
  if (/(形成于|成矿时代|年代约束)/.test(originalText)) owlTypes.push('AgeConstrainedMineral')

  return {
    originalText,
    spatialIntent: /(范围内|以内|附近|周边|方圆|距离|最近|由近到远|空间|地图|分布|缓冲区|网格|有利度|找矿潜力|成矿预测|靶区|评分|时空|演化|时间轴|年代序列|时期变化|对比|比较|区域差异)/.test(originalText),
    ...(parseAnchorName(originalText) ? { anchorName: parseAnchorName(originalText) } : {}),
    ...(radiusKm ? { radiusKm } : {}),
    entityTypes: inferEntityTypes(originalText),
    mineralKinds: unique(mineralKinds),
    timePeriods: unique(timePeriods),
    depositTypes: unique(depositTypes),
    owlTypes: unique(owlTypes),
    sortBy: /(有利度|找矿潜力|成矿预测|靶区|评分)/.test(originalText)
      ? 'score'
      : /(距离|最近|由近到远)/.test(originalText) ? 'distance' : 'name',
  }
}

export const ERA_EQUIVALENTS: Record<string, string[]> = {
  海西期: ['海西期', '华力西期', '晚古生代', '石炭纪', '二叠纪', '早二叠世', '晚二叠世'],
  华力西期: ['海西期', '华力西期', '晚古生代', '石炭纪', '二叠纪', '早二叠世', '晚二叠世'],
  晚古生代: ['海西期', '华力西期', '晚古生代', '石炭纪', '二叠纪', '早二叠世', '晚二叠世'],
  燕山期: ['燕山期', '侏罗纪', '白垩纪'],
  喜山期: ['喜山期', '古近纪'],
}
