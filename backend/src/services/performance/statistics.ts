export interface BootstrapDifference {
  meanDifference: number
  lower: number
  upper: number
}

export function percentile(values: number[], quantile: number): number {
  if (!Number.isFinite(quantile) || quantile < 0 || quantile > 1) {
    throw new RangeError('quantile must be between 0 and 1')
  }
  if (values.length === 0) return 0
  const sorted = values.filter(Number.isFinite).sort((left, right) => left - right)
  if (sorted.length === 0) return 0
  const rank = Math.max(1, Math.ceil(quantile * sorted.length))
  return sorted[rank - 1] ?? 0
}

function xorshift32(seed: number): () => number {
  let state = (seed | 0) || 1
  return () => {
    state ^= state << 13
    state ^= state >>> 17
    state ^= state << 5
    return (state >>> 0) / 0x1_0000_0000
  }
}

export function bootstrapDifference(
  enhanced: number[],
  baseline: number[],
  options: { iterations?: number; seed?: number } = {},
): BootstrapDifference {
  if (enhanced.length !== baseline.length || enhanced.length === 0) {
    throw new Error('bootstrap comparison requires paired non-empty samples')
  }
  if (enhanced.some((value) => !Number.isFinite(value)) || baseline.some((value) => !Number.isFinite(value))) {
    throw new Error('bootstrap samples must be finite')
  }
  const differences = enhanced.map((value, index) => value - baseline[index]!)
  const iterations = Math.max(100, Math.floor(options.iterations ?? 2_000))
  const random = xorshift32(options.seed ?? 1)
  const estimates: number[] = []
  for (let iteration = 0; iteration < iterations; iteration += 1) {
    let sum = 0
    for (let sample = 0; sample < differences.length; sample += 1) {
      sum += differences[Math.floor(random() * differences.length)]!
    }
    estimates.push(sum / differences.length)
  }
  return {
    meanDifference: differences.reduce((sum, value) => sum + value, 0) / differences.length,
    lower: percentile(estimates, 0.025),
    upper: percentile(estimates, 0.975),
  }
}
