import type { EvidencePersistencePolicy } from '@pickle-spec/runner'

export type ArtifactCapturePolicy = 'off' | 'on-failure' | 'always'

export function resolveEvidencePersistence(input: {
  argument?: EvidencePersistencePolicy
  configured?: EvidencePersistencePolicy
  artifactsCapture?: ArtifactCapturePolicy
}): EvidencePersistencePolicy {
  return (
    input.argument ?? input.configured ?? input.artifactsCapture ?? 'always'
  )
}
