import { renderToStaticMarkup } from 'react-dom/server'
import { expect, test } from 'vitest'
import {
  Command,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
  CommandShortcut,
} from './ui/command'
import { InputGroup, InputGroupAddon, InputGroupInput } from './ui/input-group'
import { Skeleton } from './ui/skeleton'
import { Switch } from './ui/switch'

test('renders the command foundation with Mira data slots', () => {
  const markup = renderToStaticMarkup(
    <Command>
      <CommandInput aria-label="Search commands" />
      <CommandList>
        <CommandGroup heading="Specifications">
          <CommandItem value="checkout">
            Checkout
            <CommandShortcut>Open</CommandShortcut>
          </CommandItem>
        </CommandGroup>
        <CommandSeparator />
      </CommandList>
    </Command>,
  )

  expect(markup).toContain('data-slot="command"')
  expect(markup).toContain('data-slot="command-input"')
  expect(markup).toContain('data-slot="command-list"')
  expect(markup).toContain('data-slot="command-item"')
  expect(markup).toContain('data-slot="command-shortcut"')
  expect(markup).toContain('aria-hidden="true"')
  expect(markup).toContain('**:[[cmdk-group-heading]]:text-foreground')
  expect(markup).toContain('data-[selected=true]:bg-muted')
  expect(markup).not.toContain('data-selected:bg-muted')
  expect(markup).not.toContain('shadow-')
})

test('renders input groups with one visible focus boundary', () => {
  const markup = renderToStaticMarkup(
    <InputGroup>
      <InputGroupAddon>Find</InputGroupAddon>
      <InputGroupInput aria-label="Find Specification" />
    </InputGroup>,
  )

  expect(markup).toContain('data-slot="input-group"')
  expect(markup).toContain('data-slot="input-group-addon"')
  expect(markup).toContain('data-slot="input-group-control"')
  expect(markup).toContain('focus-within:border-foreground')
  expect(markup).not.toContain('focus-visible:ring')
})

test('renders reduced-motion-safe presentational skeletons', () => {
  const markup = renderToStaticMarkup(<Skeleton className="h-4 w-24" />)

  expect(markup).toContain('data-slot="skeleton"')
  expect(markup).toContain('aria-hidden="true"')
  expect(markup).toContain('motion-reduce:animate-none')
})

test('renders switches with bounded transform and opacity motion', () => {
  const markup = renderToStaticMarkup(
    <Switch aria-label="Verbose timeline" defaultChecked />,
  )

  expect(markup).toContain('data-slot="switch-state"')
  expect(markup).toContain('transition-opacity duration-120')
  expect(markup).toContain('transition-transform duration-120')
  expect(markup).toContain('ease-[cubic-bezier(0.23,1,0.32,1)]')
  expect(markup).toContain('motion-reduce:transition-none')
  expect(markup).not.toContain('transition-all')
})
