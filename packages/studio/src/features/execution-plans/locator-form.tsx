import { type Ref, useEffect, useId, useRef } from 'react'
import { Button } from '../../components/ui/button'
import { Input } from '../../components/ui/input'
import { Label } from '../../components/ui/label'
import type { StudioWebLocator } from './execution-plan.contracts'

export interface LocatorInput {
  selector: string
  match: string
}

export interface LocatorErrors {
  selector?: string
  match?: string
  save?: string
}

type LocatorResult =
  | { ok: true; locator: StudioWebLocator }
  | { ok: false; errors: LocatorErrors }

export function parseLocatorInput(input: LocatorInput): LocatorResult {
  const errors: LocatorErrors = {}
  if (!input.selector.trim()) errors.selector = 'Enter a locator.'
  const match = input.match.trim()
  const parsedMatch = Number(match)
  if (
    match &&
    (!/^\d+$/.test(match) ||
      !Number.isSafeInteger(parsedMatch) ||
      parsedMatch < 1)
  ) {
    errors.match =
      'Enter a whole match number starting at 1, or leave it blank.'
  }
  if (errors.selector || errors.match) return { ok: false, errors }

  const segments = selectorSegments(input.selector)
  const locator: StudioWebLocator = { selector: { segments } }
  if (match) locator.nth = parsedMatch - 1
  return { ok: true, locator }
}

function selectorSegments(
  selector: string,
): StudioWebLocator['selector']['segments'] {
  const segments: StudioWebLocator['selector']['segments'] = []
  let cursor = 0
  for (const match of selector.matchAll(/<([A-Za-z_][A-Za-z0-9_.-]*)>/g)) {
    if (match.index > cursor)
      segments.push({ literal: selector.slice(cursor, match.index) })
    const variable = match[1]
    if (variable) segments.push({ variable })
    cursor = match.index + match[0].length
  }
  if (cursor < selector.length)
    segments.push({ literal: selector.slice(cursor) })
  return segments
}

interface LocatorFormProps {
  value: LocatorInput
  errors?: LocatorErrors
  saving: boolean
  dirty: boolean
  onChange(value: LocatorInput): void
  onSave(): void
  onCancel(): void
}

function useLocatorFormFocus(errors?: LocatorErrors) {
  const selectorRef = useRef<HTMLInputElement>(null)
  const matchRef = useRef<HTMLInputElement>(null)
  useEffect(() => {
    selectorRef.current?.focus()
  }, [])
  useEffect(() => {
    if (errors?.selector) selectorRef.current?.focus()
    else if (errors?.match) matchRef.current?.focus()
  }, [errors])
  return { selectorRef, matchRef }
}

export function LocatorForm(props: LocatorFormProps) {
  const id = useId()
  const { selectorRef, matchRef } = useLocatorFormFocus(props.errors)

  return (
    <form
      aria-label="Edit action locator"
      className="mt-3 min-w-0 space-y-3"
      onSubmit={(event) => {
        event.preventDefault()
        props.onSave()
      }}
    >
      <div className="space-y-1.5">
        <Label htmlFor={`${id}-selector`}>Locator</Label>
        <Input
          ref={selectorRef}
          spellCheck={false}
          autoCapitalize="none"
          id={`${id}-selector`}
          autoComplete="off"
          className="font-mono text-base sm:text-xs"
          placeholder="#submit or [data-test='submit']"
          disabled={props.saving}
          aria-invalid={Boolean(props.errors?.selector)}
          aria-describedby={`${id}-selector-help${props.errors?.selector ? ` ${id}-selector-error` : ''}`}
          value={props.value.selector}
          onChange={(event) =>
            props.onChange({ ...props.value, selector: event.target.value })
          }
        />
        <p id={`${id}-selector-help`} className="text-xs text-muted-foreground">
          Use <code>&lt;variable&gt;</code> for a required runtime value.
        </p>
        {props.errors?.selector ? (
          <p
            id={`${id}-selector-error`}
            role="alert"
            className="text-xs text-destructive"
          >
            {props.errors.selector}
          </p>
        ) : null}
      </div>
      <MatchField
        id={id}
        inputRef={matchRef}
        value={props.value.match}
        error={props.errors?.match}
        saving={props.saving}
        onChange={(match) => props.onChange({ ...props.value, match })}
      />
      {props.errors?.save ? (
        <p role="alert" className="text-xs text-destructive">
          {props.errors.save}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" size="sm" disabled={props.saving || !props.dirty}>
          {props.saving ? 'Saving…' : 'Save change'}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={props.saving}
          onClick={props.onCancel}
        >
          Cancel
        </Button>
      </div>
    </form>
  )
}

interface MatchFieldProps {
  value: string
  error?: string
  saving: boolean
  onChange(value: string): void
  id: string
  inputRef: Ref<HTMLInputElement>
}

function MatchField(props: MatchFieldProps) {
  const { id } = props
  return (
    <div className="space-y-1.5">
      <Label htmlFor={`${id}-match`}>Match number (optional)</Label>
      <Input
        ref={props.inputRef}
        id={`${id}-match`}
        autoComplete="off"
        className="max-w-32 text-base sm:text-sm"
        inputMode="numeric"
        placeholder="e.g. 1"
        disabled={props.saving}
        aria-invalid={Boolean(props.error)}
        aria-describedby={`${id}-match-help${props.error ? ` ${id}-match-error` : ''}`}
        value={props.value}
        onChange={(event) => props.onChange(event.target.value)}
      />
      <p id={`${id}-match-help`} className="text-xs text-muted-foreground">
        1 is the first match. Leave blank to use no explicit match number.
      </p>
      {props.error ? (
        <p
          id={`${id}-match-error`}
          role="alert"
          className="text-xs text-destructive"
        >
          {props.error}
        </p>
      ) : null}
    </div>
  )
}
