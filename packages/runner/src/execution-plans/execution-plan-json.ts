import { createHash } from 'node:crypto'
import type {
  Digest,
  PlanRevision,
  PlanRevisionContent,
  PlanScope,
  PlanSelection,
} from './execution-plan-revision'
import {
  planRevisionContentSchema,
  planRevisionSchema,
  planSelectionSchema,
} from './execution-plan-revision'

type JsonPrimitive = boolean | null | number | string
type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue }

class UniqueKeyJsonParser {
  private offset = 0

  constructor(private readonly source: string) {}

  parse(): unknown {
    const value = this.parseValue()
    this.skipWhitespace()
    if (this.offset !== this.source.length)
      this.fail('Unexpected trailing input')
    return value
  }

  private parseValue(): unknown {
    this.skipWhitespace()
    const token = this.source[this.offset]
    if (token === '{') return this.parseObject()
    if (token === '[') return this.parseArray()
    if (token === '"') return this.parseString()
    if (token === '-' || (token !== undefined && /[0-9]/.test(token))) {
      return this.parseNumber()
    }
    for (const [literal, value] of [
      ['true', true],
      ['false', false],
      ['null', null],
    ] as const) {
      if (this.source.startsWith(literal, this.offset)) {
        this.offset += literal.length
        return value
      }
    }
    return this.fail('Expected a JSON value')
  }

  private parseObject(): Record<string, unknown> {
    this.offset += 1
    const result: Record<string, unknown> = Object.create(null)
    const keys = new Set<string>()
    this.skipWhitespace()
    if (this.source[this.offset] === '}') {
      this.offset += 1
      return result
    }
    while (true) {
      this.parseObjectProperty(result, keys)
      if (this.finishObjectProperty()) return result
    }
  }

  private parseObjectProperty(
    result: Record<string, unknown>,
    keys: Set<string>,
  ) {
    this.skipWhitespace()
    if (this.source[this.offset] !== '"') this.fail('Expected an object key')
    const key = this.parseString()
    if (keys.has(key)) this.fail(`Duplicate object key ${JSON.stringify(key)}`)
    keys.add(key)
    this.skipWhitespace()
    if (this.source[this.offset] !== ':') this.fail('Expected a colon')
    this.offset += 1
    Object.defineProperty(result, key, {
      value: this.parseValue(),
      enumerable: true,
      configurable: true,
      writable: true,
    })
  }

  private finishObjectProperty(): boolean {
    this.skipWhitespace()
    const separator = this.source[this.offset]
    if (separator === '}') {
      this.offset += 1
      return true
    }
    if (separator !== ',') this.fail('Expected a comma or closing brace')
    this.offset += 1
    return false
  }

  private parseArray(): unknown[] {
    this.offset += 1
    const result: unknown[] = []
    this.skipWhitespace()
    if (this.source[this.offset] === ']') {
      this.offset += 1
      return result
    }
    while (true) {
      result.push(this.parseValue())
      this.skipWhitespace()
      const separator = this.source[this.offset]
      if (separator === ']') {
        this.offset += 1
        return result
      }
      if (separator !== ',') this.fail('Expected a comma or closing bracket')
      this.offset += 1
    }
  }

  private parseString(): string {
    const start = this.offset
    this.offset += 1
    while (this.offset < this.source.length) {
      const token = this.source[this.offset]
      if (token === '"') {
        this.offset += 1
        return JSON.parse(this.source.slice(start, this.offset))
      }
      if (token === '\\') this.offset += 1
      this.offset += 1
    }
    return this.fail('Unterminated string')
  }

  private parseNumber(): number {
    const source = this.source.slice(this.offset)
    const match = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/.exec(source)
    if (!match) return this.fail('Invalid number')
    this.offset += match[0].length
    const value = Number(match[0])
    if (!Number.isFinite(value)) return this.fail('Non-finite number')
    if (Number.isInteger(value) && !Number.isSafeInteger(value)) {
      return this.fail('Unsafe integer')
    }
    return value
  }

  private skipWhitespace() {
    while (isJsonWhitespace(this.source[this.offset])) this.offset += 1
  }

  private fail(message: string): never {
    throw new SyntaxError(`${message} at byte ${this.offset}`)
  }
}

function isJsonWhitespace(value: string | undefined): boolean {
  return value === ' ' || value === '\n' || value === '\r' || value === '\t'
}

function jsonValue(value: unknown, ancestors: Set<object>): JsonValue {
  if (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'boolean'
  ) {
    return value
  }
  if (typeof value === 'number') return jsonNumber(value)
  if (typeof value !== 'object')
    throw new TypeError('Value is not JSON-compatible')
  if (ancestors.has(value))
    throw new TypeError('Cyclic values are not JSON-compatible')
  ancestors.add(value)
  try {
    return Array.isArray(value)
      ? jsonArray(value, ancestors)
      : jsonObject(value, ancestors)
  } finally {
    ancestors.delete(value)
  }
}

function jsonNumber(value: number): number {
  if (!Number.isFinite(value))
    throw new TypeError('JSON numbers must be finite')
  if (Number.isInteger(value) && !Number.isSafeInteger(value)) {
    throw new TypeError('JSON integers must be safe')
  }
  return value
}

function jsonArray(value: unknown[], ancestors: Set<object>): JsonValue[] {
  for (let index = 0; index < value.length; index += 1) {
    if (!(index in value))
      throw new TypeError('Sparse arrays are not JSON-compatible')
  }
  return value.map((item) => jsonValue(item, ancestors))
}

function jsonObject(
  value: object,
  ancestors: Set<object>,
): Record<string, JsonValue> {
  const prototype = Object.getPrototypeOf(value)
  if (prototype !== Object.prototype && prototype !== null) {
    throw new TypeError('Only plain objects are JSON-compatible')
  }
  if (Object.getOwnPropertySymbols(value).length > 0) {
    throw new TypeError('Symbol keys are not JSON-compatible')
  }
  const record = value as Record<string, unknown>
  return Object.fromEntries(
    Object.keys(record)
      .sort()
      .map((key) => [key, jsonValue(record[key], ancestors)]),
  )
}

export function parseUniqueKeyJson(source: string): unknown {
  return new UniqueKeyJsonParser(source).parse()
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(jsonValue(value, new Set()))
}

export function planDigest(value: unknown): Digest {
  return createHash('sha256').update(canonicalJson(value), 'utf8').digest('hex')
}

export function planSlotId(scope: PlanScope): Digest {
  return planDigest([
    scope.scenarioId,
    scope.executionTargetProfileId,
    scope.adapterKind,
  ])
}

export function createPlanRevision(content: PlanRevisionContent): PlanRevision {
  const parsed = planRevisionContentSchema.parse(content)
  canonicalJson(parsed.adapterPayload)
  const id = planDigest(parsed)
  return planRevisionSchema.parse({ ...parsed, id })
}

export function parsePlanRevision(
  source: string,
  expectedId?: Digest,
): PlanRevision {
  const parsed = planRevisionSchema.parse(parseUniqueKeyJson(source))
  canonicalJson(parsed.adapterPayload)
  const { id: _id, ...content } = parsed
  const computedId = planDigest(content)
  if (
    parsed.id !== computedId ||
    (expectedId !== undefined && expectedId !== computedId)
  ) {
    throw new TypeError(
      'Revision digest does not match its content and filename',
    )
  }
  return parsed
}

export function parsePlanSelection(source: string): PlanSelection {
  return planSelectionSchema.parse(parseUniqueKeyJson(source))
}

export function selectionDigest(selection: PlanSelection): Digest {
  return planDigest(planSelectionSchema.parse(selection))
}

export function serializePlanDocument(value: unknown): string {
  return `${canonicalJson(value)}\n`
}
