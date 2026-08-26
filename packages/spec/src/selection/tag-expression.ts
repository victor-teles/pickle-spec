type TagExpressionNode =
  | { type: 'tag'; value: string }
  | { type: 'not'; child: TagExpressionNode }
  | { type: 'and' | 'or'; left: TagExpressionNode; right: TagExpressionNode }

function normalizedTag(tag: string): string {
  return tag.startsWith('@') ? tag : `@${tag}`
}

function tokenizeTagExpression(expression: string): string[] {
  const tokens: string[] = []
  const tokenPattern = /\(|\)|(?:and|or|not)\b|@?[A-Za-z0-9:_-]+/iy
  let index = 0

  while (index < expression.length) {
    while (/\s/.test(expression[index] ?? '')) index++
    if (index === expression.length) break

    tokenPattern.lastIndex = index
    const match = tokenPattern.exec(expression)
    if (!match) {
      throw new Error(
        `Unexpected character "${expression[index]}" in tag expression`,
      )
    }
    tokens.push(match[0])
    index = tokenPattern.lastIndex
  }

  return tokens
}

class TagExpressionParser {
  private index = 0

  constructor(private readonly tokens: readonly string[]) {}

  parse(): TagExpressionNode {
    const expression = this.disjunction()
    const remaining = this.tokens[this.index]
    if (remaining) {
      throw new Error(`Unexpected token "${remaining}" in tag expression`)
    }
    return expression
  }

  private consume(): string {
    const token = this.tokens[this.index++]
    if (!token) throw new Error('Unexpected end of tag expression')
    return token
  }

  private primary(): TagExpressionNode {
    const token = this.consume()
    if (token === '(') return this.parenthesizedExpression()
    if (/^not$/i.test(token)) return { type: 'not', child: this.primary() }
    if (/^(and|or)$/i.test(token)) {
      throw new Error(`Unexpected operator "${token}" in tag expression`)
    }
    return { type: 'tag', value: normalizedTag(token) }
  }

  private parenthesizedExpression(): TagExpressionNode {
    const expression = this.disjunction()
    if (this.consume() !== ')') {
      throw new Error('Expected ")" in tag expression')
    }
    return expression
  }

  private conjunction(): TagExpressionNode {
    let expression = this.primary()
    while (/^and$/i.test(this.tokens[this.index] ?? '')) {
      this.index++
      expression = { type: 'and', left: expression, right: this.primary() }
    }
    return expression
  }

  private disjunction(): TagExpressionNode {
    let expression = this.conjunction()
    while (/^or$/i.test(this.tokens[this.index] ?? '')) {
      this.index++
      expression = {
        type: 'or',
        left: expression,
        right: this.conjunction(),
      }
    }
    return expression
  }
}

function matchesTagExpression(
  expression: TagExpressionNode,
  tags: readonly string[],
): boolean {
  switch (expression.type) {
    case 'tag':
      return tags.includes(expression.value)
    case 'not':
      return !matchesTagExpression(expression.child, tags)
    case 'and':
      return (
        matchesTagExpression(expression.left, tags) &&
        matchesTagExpression(expression.right, tags)
      )
    case 'or':
      return (
        matchesTagExpression(expression.left, tags) ||
        matchesTagExpression(expression.right, tags)
      )
  }
}

export function validateTagExpression(expression: string): void {
  new TagExpressionParser(tokenizeTagExpression(expression)).parse()
}

export function createTagPredicate(
  expression: string | undefined,
): (tags: readonly string[]) => boolean {
  if (!expression) return () => true
  const parsed = new TagExpressionParser(
    tokenizeTagExpression(expression),
  ).parse()
  return (tags) => matchesTagExpression(parsed, tags)
}
