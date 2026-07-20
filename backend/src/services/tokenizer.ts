/**
 * 中文分词器 — 封装 nodejieba
 * 如果 nodejieba 不可用，回退到简单的字粒度切分
 */

import { createRequire } from 'node:module'

let jieba: any = null
let jiebaAvailable = false

function loadJieba(): void {
  if (jieba !== null) return
  try {
    // nodejieba 是 native 模块，用 createRequire 加载比动态 import 更可靠
    const _require = createRequire(import.meta.url)
    jieba = _require('nodejieba')
    jiebaAvailable = true
    // 插入自定义词典（地质找矿领域术语 + 国土空间规划领域术语）
    const terms = [
      // --- 地质找矿领域 ---
      // 矿产
      '钒钛磁铁矿', '钛磁铁矿', '磁黄铁矿', '黄铜矿', '黄铁矿', '赤铁矿',
      '磁铁矿', '钛铁矿', '铜镍矿', '铬铁矿', '菱铁矿', '褐铁矿',
      '铅锌矿', '斑岩铜矿', '矽卡岩', '热液矿床', '沉积矿床',
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
    ]
    for (const term of terms) {
      jieba.insertWord(term)
    }
    console.log('[tokenizer] nodejieba 已加载，自定义词典已注入')
  } catch {
    jiebaAvailable = false
    console.warn('[tokenizer] nodejieba 不可用，使用字粒度回退分词')
  }
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
  loadJieba()

  if (jiebaAvailable && jieba) {
    const words: string[] = jieba.cut(text)
    return words.filter((w) => {
      const trimmed = w.trim()
      if (trimmed.length === 0) return false
      if (STOP_WORDS.has(trimmed)) return false
      // 过滤纯数字/标点
      if (/^[\d.,;:!?，。；：！？、""''（）\(\)\[\]【】《》\s]+$/.test(trimmed)) return false
      return true
    })
  }

  // 回退：按字符切分，过滤停用词和标点
  return text
    .split('')
    .filter((ch) => {
      if (STOP_WORDS.has(ch)) return false
      if (/^[\d.,;:!?，。；：！？、""''（）\(\)\[\]【】《》\s]$/.test(ch)) return false
      return ch.trim().length > 0
    })
}

/** 批量分词 */
export function tokenizeBatch(texts: string[]): string[][] {
  return texts.map((t) => tokenize(t))
}
