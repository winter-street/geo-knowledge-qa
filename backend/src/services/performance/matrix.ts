import { PERFORMANCE_MODES, type BenchmarkCase, type PerformanceMode } from './types.js'

export interface MatrixCase extends BenchmarkCase {
  mode: PerformanceMode
}

export function buildEvaluationMatrix(
  cases: BenchmarkCase[],
  modes: readonly PerformanceMode[] = PERFORMANCE_MODES,
): MatrixCase[] {
  const seen = new Set<string>()
  return cases.flatMap((testCase) => modes.map((mode) => {
    const key = `${testCase.id}:${mode}`
    if (seen.has(key)) throw new Error(`Duplicate evaluation matrix item: ${key}`)
    seen.add(key)
    return { ...testCase, mode }
  }))
}
