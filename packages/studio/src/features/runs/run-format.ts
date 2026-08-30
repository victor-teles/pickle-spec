export function durationLabel(durationMs: number | undefined): string {
  if (durationMs === undefined) return 'In progress'
  if (durationMs < 1_000) return `${durationMs} ms`
  return `${(durationMs / 1_000).toFixed(1)} s`
}

export function resultCountLabel(count: number): string {
  return `${count} ${count === 1 ? 'result' : 'results'}`
}

export function inferenceCountLabel(count: number | undefined): string {
  if (count === undefined) return 'Not recorded'
  return `${count} ${count === 1 ? 'inference' : 'inferences'}`
}

export function bytesLabel(bytes: number): string {
  if (bytes < 1_024) return `${bytes} B`
  if (bytes < 1_024 ** 2) return `${(bytes / 1_024).toFixed(1)} KB`
  if (bytes < 1_024 ** 3) return `${(bytes / 1_024 ** 2).toFixed(1)} MB`
  return `${(bytes / 1_024 ** 3).toFixed(1)} GB`
}
