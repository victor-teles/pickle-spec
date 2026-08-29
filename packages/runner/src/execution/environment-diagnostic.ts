export interface EnvironmentRemediation {
  summary: string
}

export type EnvironmentDiagnostic =
  | {
      id: string
      kind: 'ready'
      message: string
    }
  | {
      id: string
      kind: 'blocked'
      message: string
      remediation: readonly [
        EnvironmentRemediation,
        ...EnvironmentRemediation[],
      ]
    }
