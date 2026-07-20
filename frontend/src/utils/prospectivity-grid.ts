import type { ProspectivityGridCell, ProspectivityTarget } from '../types/index.js'

const DEMO_DISCLAIMER = '规则评分、网格和靶区仅用于功能演示，不作为实际勘查结论。'

export function gridCellColor(score: number): string {
  if (score >= 85) return '#B83A1F'
  if (score >= 65) return '#B8860B'
  return '#2E7D5B'
}

export function gridTargetSummary(target: ProspectivityTarget): string {
  return [
    target.name,
    `${target.areaKm2} km²`,
    `均分 ${target.averageScore}`,
    target.dominantMineralKind,
    target.dominantEra,
  ].filter(Boolean).join(' · ')
}

export function gridCellDetails(cell: ProspectivityGridCell): {
  title: string
  metrics: string
  factors: ProspectivityGridCell['factors']
  disclaimer: string
} {
  return {
    title: `${cell.id} · ${cell.score} 分`,
    metrics: [
      `${cell.pointCount} 个格内点`,
      cell.dominantMineralKind,
      cell.dominantEra,
    ].filter(Boolean).join(' · '),
    factors: cell.factors,
    disclaimer: DEMO_DISCLAIMER,
  }
}

export function gridTargetDetails(target: ProspectivityTarget): {
  title: string
  metrics: string
  evidence: string
  disclaimer: string
} {
  return {
    title: target.name,
    metrics: `${target.areaKm2} km² · 均分 ${target.averageScore} · 最高 ${target.maxScore}`,
    evidence: [
      `${target.cellCount} 个高分网格`,
      `${target.pointCount} 个关联点`,
      target.dominantMineralKind,
      target.dominantEra,
    ].filter(Boolean).join(' · '),
    disclaimer: DEMO_DISCLAIMER,
  }
}
