import type { PerformanceSummary, PublicPerformanceSummary } from './types.js'

function percent(value: number): string {
  return `${(value * 100).toFixed(1)}%`
}

function thresholdRows(summary: PerformanceSummary | PublicPerformanceSummary): string {
  const rows = Object.entries(summary.thresholds).map(([name, item]) =>
    `| ${name} | ${item.value.toFixed(3)} | ${item.operator} ${item.threshold.toFixed(3)} | ${item.passed ? 'pass' : 'fail'} |`)
  return rows.length > 0 ? rows.join('\n') : '| none | 0 | n/a | n/a |'
}

function modeRows(summary: PerformanceSummary | PublicPerformanceSummary): string {
  return summary.modes.map((mode) => mode.requestCount === 0
    ? `| ${mode.mode} | 0 | n/a | n/a | n/a | n/a |`
    : `| ${mode.mode} | ${mode.requestCount} | ${percent(mode.successRate)} | ${mode.latencyMs.p50.toFixed(1)} | ${mode.latencyMs.p95.toFixed(1)} | ${mode.latencyMs.p99.toFixed(1)}${mode.latencyMs.p99ReferenceOnly ? '*' : ''} |`)
    .join('\n')
}

export function renderPublicReport(summary: PublicPerformanceSummary): string {
  const resourceRows = summary.resources.length > 0
    ? summary.resources.map((item) => `| ${item.name} | ${item.sampleCount} | ${(item.availabilityRate * 100).toFixed(1)}% | ${item.peakWorkingSetBytes ?? 'n/a'} | ${item.peakCpuPercent?.toFixed(2) ?? 'n/a'} |`).join('\n')
    : '| none | 0 | n/a | n/a | n/a |'
  return `# Agent Performance Evaluation\n\n`
    + `${summary.manifest.synthetic
      ? 'This is deterministic synthetic harness validation, not a model-performance claim.'
      : 'Remote model latency is environment-dependent; this report does not benchmark the provider inference engine.'}\n\n`
    + `Run: \`${summary.manifest.runId}\`  \nLabel: \`${summary.manifest.label}\`  \nObservations: ${summary.observationCount}\n\n`
    + `| Mode | Requests | Success | P50 ms | P95 ms | P99 ms |\n|---|---:|---:|---:|---:|---:|\n${modeRows(summary)}\n\n`
    + `| Threshold | Value | Target | Status |\n|---|---:|---:|---|\n${thresholdRows(summary)}\n\n`
    + `| Process | Samples | Available | Peak working set bytes | Peak CPU % |\n|---|---:|---:|---:|---:|\n${resourceRows}\n\n`
    + `Raw success: ${percent(summary.overall.rawSuccessRate)}; supplier rate limit: ${percent(summary.overall.supplierRateLimitRate)}.\n\n`
    + `${summary.limitations.length > 0 ? `Limitations:\n\n${summary.limitations.map((item) => `- ${item}`).join('\n')}\n\n` : ''}`
    + `P99 values marked with * are reference-only because the sample has fewer than 100 observations.\n\n`
    + `Privacy: no raw questions, answers, evidence, titles, coordinates, credentials, or session contents are included.\n`
}

export function renderPrivateReport(summary: PerformanceSummary): string {
  const errors = summary.errorCategories.length > 0
    ? summary.errorCategories.map((item) => `- ${item.category}: ${item.count}`).join('\n')
    : '- none'
  return `${renderPublicReport({ ...summary, privacy: { rawContentIncluded: false, publishable: false } })}\n`
    + `## Private Diagnostics\n\nErrors:\n\n${errors}\n\n`
}

function csv(value: string | number): string {
  const text = String(value)
  return /[",\r\n]/u.test(text) ? `"${text.replace(/"/gu, '""')}"` : text
}

export interface BlindReviewInput {
  sampleId: string
  question: string
  answer: string
  allowedEvidence: string
}

export function renderBlindReviewCsv(rows: BlindReviewInput[]): string {
  const header = ['sample_id', 'question', 'answer', 'allowed_evidence', 'task_completion_0_2', 'citation_support_0_2', 'notes']
  return [header.join(','), ...rows.map((row) => [
    row.sampleId, row.question, row.answer, row.allowedEvidence, '', '', '',
  ].map(csv).join(','))].join('\n') + '\n'
}
