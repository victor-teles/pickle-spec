import {
  DatabaseSync,
  type SQLOutputValue,
  type SQLInputValue,
} from 'node:sqlite'

type NamedParameters = Record<string, SQLInputValue>
type Parameters = SQLInputValue[] | NamedParameters
type Query<Row, Bindings extends Parameters> = {
  get(
    ...parameters: Bindings extends SQLInputValue[] ? Bindings : [Bindings]
  ): Row | undefined
  all(
    ...parameters: Bindings extends SQLInputValue[] ? Bindings : [Bindings]
  ): Row[]
  run(
    ...parameters: Bindings extends SQLInputValue[] ? Bindings : [Bindings]
  ): { changes: number | bigint; lastInsertRowid: number | bigint }
}

/** Synchronous SQL access shared by the cache and Test run index. */
export class Database {
  private readonly connection: DatabaseSync

  constructor(path: string) {
    this.connection = new DatabaseSync(path)
  }

  close(): void {
    this.connection.close()
  }

  run(sql: string, parameters: SQLInputValue[] | NamedParameters = []) {
    const statement = this.connection.prepare(sql)
    statement.setAllowUnknownNamedParameters(true)
    return Array.isArray(parameters)
      ? statement.run(...parameters)
      : statement.run(parameters)
  }

  query<
    Row = Record<string, SQLOutputValue>,
    Bindings extends Parameters = SQLInputValue[],
  >(sql: string) {
    const statement = this.connection.prepare(sql)
    statement.setAllowUnknownNamedParameters(true)
    // SQLite does not infer row types from SQL; callers own the schema and bindings.
    // oxlint-disable-next-line anti-slop/no-chained-type-assertions
    return statement as unknown as Query<Row, Bindings>
  }

  transaction<Value>(operation: () => Value) {
    const execute = (mode: 'DEFERRED' | 'IMMEDIATE') => {
      this.connection.exec(`BEGIN ${mode}`)
      try {
        const value = operation()
        this.connection.exec('COMMIT')
        return value
      } catch (error) {
        this.connection.exec('ROLLBACK')
        throw error
      }
    }
    return Object.assign(() => execute('DEFERRED'), {
      immediate: () => execute('IMMEDIATE'),
    })
  }
}
