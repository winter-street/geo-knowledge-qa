/** Node 22 内置分词器 + 领域词典，避免原生扩展的 ABI 与安装链风险。 */

const DOMAIN_TERMS = new Set([
      // --- 地质找矿领域 ---
      // 矿产
      '钒钛磁铁矿', '钛磁铁矿', '磁黄铁矿', '黄铜矿', '黄铁矿', '赤铁矿',
      '磁铁矿', '钛铁矿', '铜镍矿', '铬铁矿', '菱铁矿', '褐铁矿',
      '铅锌矿', '斑岩铜矿', '铜矿', '矿床', '矽卡岩', '热液矿床', '沉积矿床',
      // 岩石
      '花岗岩', '辉长岩', '闪长岩', '大理岩', '辉石岩', '玄武岩',
      '碱性辉长岩', '片岩', '砂岩', '石灰岩', '页岩', '板岩',
      '片麻岩', '安山岩', '流纹岩', '橄榄岩', '蛇绿岩',
      // 构造
      '断裂带', '褶皱', '背斜', '向斜', '走滑断层', '逆冲断层',
      '正断层', '推覆构造', '韧性剪切带', '构造窗',
      // 地质年代
      '显生宙', '古生代', '二叠纪', '二叠系', '早二叠世', '中元古界',
      '下石炭统', '上古生界', '赛力亚克达坂群', '塞拉加兹塔格岩群',
      '寒武纪', '奥陶纪', '志留纪', '泥盆纪', '石炭纪', '三叠纪',
      '侏罗纪', '白垩纪', '古近纪', '新近纪', '第四纪',
      '燕山期', '喜山期', '华力西期', '加里东期',
      // 成矿类型
      '沉积型', '热液型', '岩浆型', '变质型', '风化壳型', '矽卡岩型',
      // 地名/矿区
      '攀枝花', '攀西', '尾亚', '香山', '黄沙坪', '湘南',
      // --- 国土空间规划领域 ---
      '城镇开发边界', '永久基本农田', '生态保护红线', '三条控制线',
      '社会福利用地', '公共管理与公共服务用地', '用地用海分类',
      '容积率', '建筑密度', '绿地率', '用地兼容性',
      '国土空间规划', '控制性详细规划', '修建性详细规划',
      '总体规划', '详细规划', '专项规划',
      '城镇住宅用地', '农村宅基地', '商业服务业用地',
      '养老服务设施', '用途管制', '占补平衡',
      '城市体检', '双评价', '留白用地', '地下空间',
      '开发边界', '建设控制地带', '历史文化保护线',
])

const segmenter = new Intl.Segmenter('zh-CN', { granularity: 'word' })

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

const domainTermPattern = new RegExp(
  `(${[...DOMAIN_TERMS]
    .sort((left, right) => right.length - left.length)
    .map(escapeRegExp)
    .join('|')})`,
  'gu',
)

function segmentWithDomainTerms(text: string): string[] {
  const result: string[] = []
  for (const part of text.split(domainTermPattern)) {
    if (!part) continue
    if (DOMAIN_TERMS.has(part)) {
      result.push(part)
      continue
    }
    for (const token of segmenter.segment(part)) {
      if (token.isWordLike) result.push(token.segment)
    }
  }
  return result
}

/** 停用词列表 */
const STOP_WORDS = new Set([
  '的', '了', '在', '是', '我', '有', '和', '就', '不', '人', '都', '一',
  '一个', '上', '也', '很', '到', '说', '要', '去', '你', '会', '着',
  '没有', '看', '好', '自己', '这', '他', '她', '它', '们', '那', '些',
  '所', '为', '所以', '因为', '但是', '然而', '可以', '这个', '那个',
  '与', '及', '或', '对', '向', '从', '以', '之', '其', '中', '等',
  '该', '已', '将', '被', '把', '让', '使', '能', '于', '则', '又',
  '而', '且', '但', '如', '若', '只', '仍', '还', '便', '虽', '因',
  '按', '受', '较', '过', '各', '更', '同', '亦', '今', '每', '比',
])

/** 分词并过滤停用词 */
export function tokenize(text: string): string[] {
  return segmentWithDomainTerms(text).filter((word) => {
    const trimmed = word.trim()
    return trimmed.length > 0
      && !STOP_WORDS.has(trimmed)
      && !/^\p{Number}+$/u.test(trimmed)
  })
}

/** 批量分词 */
export function tokenizeBatch(texts: string[]): string[][] {
  return texts.map((t) => tokenize(t))
}
