export const specificationStates = ['draft', 'active', 'deprecated'] as const
export type SpecificationState = (typeof specificationStates)[number]

export const idTagPrefix = '@pickle:id:'
export const stateTagPrefix = '@pickle:state:'
export const rowIdColumn = 'pickle_id'
export const idPattern = /^[A-Za-z0-9_-]+$/
