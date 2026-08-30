import { InvalidArgumentError } from 'commander'

export function integer(flag: string, minimum: number) {
  return (value: string): number => {
    const parsed = Number(value)
    if (!Number.isSafeInteger(parsed) || parsed < minimum) {
      throw new InvalidArgumentError(
        `${flag} requires an integer greater than or equal to ${minimum}`,
      )
    }
    return parsed
  }
}

export function oneOf<const Value extends string>(
  flag: string,
  values: readonly Value[],
) {
  return (value: string): Value => {
    const parsed = values.find((candidate) => candidate === value)
    if (!parsed) {
      throw new InvalidArgumentError(`${flag} requires ${values.join(', ')}`)
    }
    return parsed
  }
}

export function collect<Value>(value: Value, previous?: Value[]): Value[] {
  return [...(previous ?? []), value]
}
