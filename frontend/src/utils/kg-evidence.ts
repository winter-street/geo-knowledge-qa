import type { KGPath } from '@/types'

export interface KgProvenanceSummary {
  mockCount: number
  inferredCount: number
  hasMock: boolean
}

export function summarizeKgProvenance(paths: KGPath[]): KgProvenanceSummary {
  const mockCount = paths.filter((path) => path.isMock).length
  const inferredCount = paths.filter((path) => path.inferred).length
  return {
    mockCount,
    inferredCount,
    hasMock: mockCount > 0,
  }
}
