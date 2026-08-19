// biome-ignore-all lint/suspicious/noArrayIndexKey: Gherkin children are ordered and may share names
import { Button } from './components/ui/button'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from './components/ui/collapsible'
import type {
  StructuredChild,
  StructuredSpecification,
} from './specification-editor'

function visibleTags(tags: readonly string[]) {
  return tags.filter((tag) => !tag.startsWith('@pickle:id:'))
}

function TagList(props: { tags: readonly string[] }) {
  const tags = visibleTags(props.tags)
  if (tags.length === 0) return null
  return (
    <p className="font-mono text-[0.625rem] leading-4 text-muted-foreground">
      {tags.join(' ')}
    </p>
  )
}

function OutlineName(props: { name: string }) {
  if (!props.name) return null
  return <span className="text-sm">{props.name}</span>
}

function scenarioNames(items: readonly StructuredChild[]): string[] {
  const names: string[] = []
  for (const child of items) {
    if (child.kind === 'rule') names.push(...scenarioNames(child.children))
    if (child.kind === 'scenario' && child.name) names.push(child.name)
  }
  return names
}

function OutlineRows(props: {
  items: readonly StructuredChild[]
  depth: number
}) {
  return (
    <ol className={props.depth > 0 ? 'space-y-1 pl-4' : 'space-y-1'}>
      {props.items.map((child, index) => (
        <li key={`${child.kind}-${child.name}-${index}`} className="space-y-1">
          {child.kind === 'rule' ? (
            <>
              <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                <span className="text-xs text-muted-foreground">Rule</span>
                <OutlineName name={child.name} />
              </div>
              <TagList tags={child.tags} />
              <OutlineRows items={child.children} depth={props.depth + 1} />
            </>
          ) : child.kind === 'background' ? (
            <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
              <span className="text-xs text-muted-foreground">Background</span>
              <OutlineName name={child.name} />
            </div>
          ) : (
            <>
              <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                <span className="text-xs text-muted-foreground">
                  {child.keyword}
                </span>
                <OutlineName name={child.name} />
              </div>
              <TagList tags={child.tags} />
              {child.examples.map((examples, examplesIndex) => (
                <div
                  key={`${examples.name}-${examplesIndex}`}
                  className="space-y-1 pl-4"
                >
                  <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                    <span className="text-xs text-muted-foreground">
                      Examples
                    </span>
                    <OutlineName name={examples.name} />
                  </div>
                  <TagList tags={examples.tags} />
                </div>
              ))}
            </>
          )}
        </li>
      ))}
    </ol>
  )
}

export function SpecificationOutline(props: {
  specification: StructuredSpecification
}) {
  const names = scenarioNames(props.specification.children)
  return (
    <section aria-label="Specification outline" className="space-y-1">
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
        <span className="text-xs text-muted-foreground">Feature</span>
        <span className="text-sm font-medium">{props.specification.name}</span>
      </div>
      <TagList tags={props.specification.tags} />
      {names.length > 0 ? (
        <p className="text-sm text-muted-foreground">{names.join(' · ')}</p>
      ) : null}
      <Collapsible>
        <CollapsibleTrigger
          render={<Button type="button" size="sm" variant="outline" />}
        >
          Show structure
        </CollapsibleTrigger>
        <CollapsibleContent className="pt-2">
          <OutlineRows items={props.specification.children} depth={0} />
        </CollapsibleContent>
      </Collapsible>
    </section>
  )
}
