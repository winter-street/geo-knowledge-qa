import { tokenize } from './tokenizer.js'

export type KGRelationType =
  | 'HOSTED_IN'
  | 'CONTROLLED_BY'
  | 'FORMED_IN'
  | 'LIES_IN'

export interface KGQueryAnalysis {
  keywords: string[]
  entityTerms: string[]
  regionTerms: string[]
  relationIntents: KGRelationType[]
  owlRules: string[]
}

const STOP_WORDS = new Set([
  '什么', '哪些', '哪个', '哪类', '怎么', '如何', '是否', '有没有',
  '介绍', '一下', '相关', '请问', '以及', '还有', '其中', '这个',
  '那个', '受到', '受', '的', '和', '与', '在', '中', '了',
])

const RELATION_NOISE = new Set([
  '赋存', '围岩', '岩石', '寄主', '构造', '控制', '受控', '控矿',
  '形成', '成矿', '时代', '年代', '位于', '分布', '区域', '地区',
])

const REGION_GROUPS = [
  ['东天山成矿带', '新疆', '哈密', '东天山', '觉罗塔格'],
  ['攀西钒钛成矿带', '四川', '攀枝花', '攀西', '西昌', '峨眉山'],
  ['长江中下游成矿带', '长江中下游', '安徽', '铜陵', '庐枞', '鄂东南', '大冶'],
  ['胶东金成矿区', '山东', '胶东', '莱州', '招远', '烟台'],
  ['滇黔桂成矿区', '云南', '贵州', '广西', '滇黔桂', '个旧', '大厂'],
  ['秦岭成矿带', '陕西', '河南', '秦岭', '小秦岭', '金堆城'],
  ['南岭成矿带', '湖南', '江西', '广东', '南岭', '柿竹园', '瑶岗仙'],
  ['冈底斯-三江成矿带', '西藏', '冈底斯', '拉萨', '三江', '甲玛', '驱龙', '玉龙'],
  ['辽吉铁金成矿区', '辽宁', '吉林', '辽吉', '鞍山', '本溪', '夹皮沟'],
  ['白云鄂博稀土成矿区', '内蒙古', '包头', '白云鄂博', '阴山'],
] as const

const RELATION_RULES: Array<{
  relation: KGRelationType
  terms: string[]
  owlRule?: string
}> = [
  {
    relation: 'HOSTED_IN',
    terms: ['赋存', '围岩', '容矿岩石', '含矿岩石', '寄主岩'],
    owlRule: 'RockHostedMineral',
  },
  {
    relation: 'CONTROLLED_BY',
    terms: ['构造控制', '受控', '控矿', '断裂控制', '构造约束'],
    owlRule: 'StructurallyControlledMineral',
  },
  {
    relation: 'FORMED_IN',
    terms: ['形成时代', '成矿时代', '形成于', '年代约束', '时代约束'],
    owlRule: 'AgeConstrainedMineral',
  },
  {
    relation: 'LIES_IN',
    terms: ['位于', '分布在', '哪个区域', '所在地区'],
  },
]

function normalizeToken(token: string): string {
  return token.trim().replace(/^[\p{P}\p{S}\s]+|[\p{P}\p{S}\s]+$/gu, '')
}

function uniqueLongestTerms(terms: string[]): string[] {
  const unique = [...new Set(terms)]
  return unique.filter((term) => !unique.some(
    (other) => other !== term && other.length > term.length && other.includes(term),
  ))
}

function detectRegionTerms(question: string, tokens: string[]): string[] {
  const tokenSet = new Set(tokens)
  const detected: string[] = []
  for (const aliases of REGION_GROUPS) {
    const matches = aliases
      .filter((alias) => question.includes(alias) || tokenSet.has(alias))
      .sort((a, b) => b.length - a.length)
    if (matches[0]) detected.push(matches[0])
  }
  return detected
}

export function analyzeKgQuestion(
  question: string,
  suppliedTokens?: string[],
): KGQueryAnalysis {
  const normalizedTokens = (suppliedTokens ?? tokenize(question))
    .map(normalizeToken)
    .filter((token) => token.length >= 2 && !STOP_WORDS.has(token))

  const regionTerms = detectRegionTerms(question, normalizedTokens)
  const relationRules = RELATION_RULES.filter((rule) =>
    rule.terms.some((term) => question.includes(term)),
  )
  const relationIntents = relationRules.map((rule) => rule.relation)
  const owlRules = relationRules.flatMap((rule) => rule.owlRule ? [rule.owlRule] : [])

  const keywords = uniqueLongestTerms(normalizedTokens)
    .filter((token) => !RELATION_NOISE.has(token))
    .slice(0, 8)
  const regionSet = new Set(regionTerms)
  const entityTerms = keywords.filter((token) => !regionSet.has(token))

  return {
    keywords,
    entityTerms,
    regionTerms,
    relationIntents,
    owlRules,
  }
}
