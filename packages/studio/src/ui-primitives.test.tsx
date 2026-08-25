import { expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import {
  Command,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandShortcut,
} from './components/ui/command'
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from './components/ui/input-group'
import { Skeleton } from './components/ui/skeleton'

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
      </CommandList>
    </Command>,
  )

  expect(markup).toContain('data-slot="command"')
  expect(markup).toContain('data-slot="command-input"')
  expect(markup).toContain('data-slot="command-list"')
  expect(markup).toContain('data-slot="command-item"')
  expect(markup).toContain('data-slot="command-shortcut"')
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
