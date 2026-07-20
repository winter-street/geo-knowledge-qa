import type { SpatialData } from '@/types'

/**
 * 实体类别 → 显示名 + 配色。
 * key 与后端 Neo4j 标签（PascalCase）对齐。
 * 配色取自全局设计变量的语义色板：
 *   矿产 = 暖红(danger)、构造 = 机构蓝(accent)、岩石 = 琥珀(warning)、
 *   矿床 = 紫、年代 = 墨绿。
 */
export const CATEGORY_META: Record<string, { label: string; color: string }> = {
  Mineral: { label: '矿产', color: '#B83A1F' },
  Structure: { label: '构造/断裂', color: '#1E3A5F' },
  Rock: { label: '岩石', color: '#B8860B' },
  DepositType: { label: '矿床类型', color: '#7B4B94' },
  TimePeriod: { label: '地质年代', color: '#2E5D3A' },
}

/** 未登记类别的兜底配色（暖灰） */
export const DEFAULT_CATEGORY_COLOR = '#6B6B78'

/** 取类别配色 */
export function categoryColor(type: string): string {
  return CATEGORY_META[type]?.color ?? DEFAULT_CATEGORY_COLOR
}

/** 取类别显示名（未登记则回退到原始 type） */
export function categoryLabel(type: string): string {
  return CATEGORY_META[type]?.label ?? type
}

/** 判断空间数据是否含有可渲染内容 */
export function hasGeo(sd: SpatialData | null | undefined): boolean {
  if (!sd) return false
  return (sd.markers?.length ?? 0) > 0 || (sd.polylines?.length ?? 0) > 0
}

/**
 * 汇总一份空间数据里出现过的所有类别（markers 与 polylines 的 type 并集），
 * 用于动态生成图层控制面板 —— 只显示当前数据真实存在的图层。
 */
export function collectCategories(sd: SpatialData | null | undefined): string[] {
  if (!sd) return []
  const set = new Set<string>()
  sd.markers?.forEach((m) => set.add(m.type))
  sd.polylines?.forEach((p) => set.add(p.type))
  return [...set]
}
