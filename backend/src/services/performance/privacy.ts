import type { PerformanceModeSummary, PerformanceSummary, PublicPerformanceSummary } from './types.js'

function projectMode(mode: PerformanceModeSummary): PerformanceModeSummary {
  return {
    mode: mode.mode,
    requestCount: mode.requestCount,
    successRate: mode.successRate,
    errorRate: mode.errorRate,
    timeoutRate: mode.timeoutRate,
    latencyMs: { ...mode.latencyMs },
    ...(mode.sseMs ? { sseMs: { ...mode.sseMs } } : {}),
    ...(mode.retrieval ? { retrieval: { ...mode.retrieval } } : {}),
    ...(mode.quality ? { quality: { ...mode.quality } } : {}),
  }
}

export function sanitizePublicSummary(summary: PerformanceSummary): PublicPerformanceSummary {
  return {
    schemaVersion: '1.0',
    manifest: {
      runId: summary.manifest.runId,
      label: summary.manifest.label,
      createdAt: summary.manifest.createdAt,
      gitCommit: summary.manifest.gitCommit,
      nodeVersion: summary.manifest.nodeVersion,
      ...(summary.manifest.pythonVersion ? { pythonVersion: summary.manifest.pythonVersion } : {}),
      ...(summary.manifest.neo4jVersion ? { neo4jVersion: summary.manifest.neo4jVersion } : {}),
      ...(summary.manifest.dataSnapshotHash ? { dataSnapshotHash: summary.manifest.dataSnapshotHash } : {}),
      model: summary.manifest.model,
      synthetic: summary.manifest.synthetic,
    },
    observationCount: summary.observationCount,
    modes: summary.modes.map(projectMode),
    overall: { ...summary.overall },
    thresholds: Object.fromEntries(Object.entries(summary.thresholds).map(([name, item]) => [name, { ...item }])),
    errorCategories: summary.errorCategories.map((item) => ({ category: item.category, count: item.count })),
    resources: summary.resources.map((item) => ({ ...item })),
    limitations: [...summary.limitations],
    privacy: { rawContentIncluded: false, publishable: true },
  }
}

export function findSensitiveCanaries(serialized: string, canaries: string[]): string[] {
  return canaries.filter((canary) => canary.length > 0 && serialized.includes(canary))
}
