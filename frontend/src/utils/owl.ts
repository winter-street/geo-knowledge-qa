import type { KGPath } from '@/types'

export interface OwlTypeMeta {
  label: string
  description: string
  relation: string
}

export interface OwlEvidenceSummary extends OwlTypeMeta {
  type: string
  entities: string[]
}

export const OWL_TYPE_META: Record<string, OwlTypeMeta> = {
  RockHostedMineral: {
    label: '赋存岩石',
    description: '由「赋存于」关系支持',
    relation: '赋存于',
  },
  StructurallyControlledMineral: {
    label: '构造控制',
    description: '由「受控于」关系支持',
    relation: '受控于',
  },
  AgeConstrainedMineral: {
    label: '形成时代',
    description: '由「形成于」关系支持',
    relation: '形成于',
  },
}

const OWL_TYPE_ORDER = Object.keys(OWL_TYPE_META)

export function owlTypeMeta(type: string): OwlTypeMeta {
  return OWL_TYPE_META[type] || {
    label: type,
    description: 'OWL 定义类推理',
    relation: '',
  }
}

export function summarizeOwlEvidence(paths: KGPath[]): OwlEvidenceSummary[] {
  const entitiesByType = new Map<string, Set<string>>()

  const collect = (types: string[] | undefined, entity: string) => {
    for (const type of types || []) {
      if (!entitiesByType.has(type)) entitiesByType.set(type, new Set())
      entitiesByType.get(type)!.add(entity)
    }
  }

  for (const path of paths) {
    collect(path.fromOwlTypes, path.from)
    collect(path.toOwlTypes, path.to)
  }

  return [...entitiesByType.entries()]
    .sort(([a], [b]) => {
      const ai = OWL_TYPE_ORDER.indexOf(a)
      const bi = OWL_TYPE_ORDER.indexOf(b)
      return (ai < 0 ? Number.MAX_SAFE_INTEGER : ai) - (bi < 0 ? Number.MAX_SAFE_INTEGER : bi)
    })
    .map(([type, entities]) => ({
      type,
      ...owlTypeMeta(type),
      entities: [...entities].sort((a, b) => a.localeCompare(b, 'zh-CN')),
    }))
}

export function formatEvidenceEntities(entities: string[], limit = 5): string {
  const visible = entities.slice(0, limit).join('、')
  return entities.length > limit ? `${visible}等 ${entities.length} 项` : visible
}
