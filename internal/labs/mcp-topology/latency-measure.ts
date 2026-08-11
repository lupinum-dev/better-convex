export interface LatencySummary {
  readonly count: number
  readonly maximumMs: number
  readonly medianMs: number
  readonly p95Ms: number
}

/** Measurement-only helper. It owns no topology, protocol, or acceptance threshold. */
export async function measureSequentialLatency(
  operation: () => Promise<unknown>,
  count = 20,
): Promise<LatencySummary> {
  if (!Number.isInteger(count) || count < 1 || count > 100) {
    throw new TypeError('Latency sample count must be bounded')
  }
  const samples: number[] = []
  for (let index = 0; index < count; index += 1) {
    const started = performance.now()
    await operation()
    samples.push(performance.now() - started)
  }
  samples.sort((left, right) => left - right)
  const percentile = (value: number) => samples[Math.ceil(samples.length * value) - 1]!
  return Object.freeze({
    count,
    maximumMs: samples.at(-1)!,
    medianMs: percentile(0.5),
    p95Ms: percentile(0.95),
  })
}

export function formatLatencySummary(label: string, summary: LatencySummary): string {
  return `[${label}] count=${summary.count} medianMs=${summary.medianMs.toFixed(2)} p95Ms=${summary.p95Ms.toFixed(2)} maximumMs=${summary.maximumMs.toFixed(2)}`
}
