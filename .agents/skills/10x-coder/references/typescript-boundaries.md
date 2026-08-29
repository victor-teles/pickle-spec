# TypeScript boundary guide

Read this guide when code accepts configuration, CLI arguments, archives,
persisted JSON, plans, or other untrusted input. The goal is to turn `unknown`
into a trustworthy domain type once, without spreading defensive parsing or
loosely typed records through the codebase.

## Parse once at the edge

- Parse untrusted input with the repository's existing schema library and
  return the inferred domain type.
- Let internal functions that accept `T` trust `T`. Do not send typed values
  back through validators that accept `unknown`.
- Keep the schema with the type or context it owns. Do not create a schema
  package whose only purpose is re-exporting the library.
- Reject invalid JSON, or use `safeParse` when the product explicitly treats a
  failure as missing. Never silently coerce invalid input to `{}`.
- Use strict objects when extra keys are a contract error. Know the schema
  library's default behavior before depending on stripping or passthrough.

```ts
// Avoid: object-shaped data is still not a domain value.
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function parseOptions(value: unknown): Options {
  if (!isRecord(value)) throw new Error('Options must be an object')
  return value as unknown as Options
}

// Prefer: the boundary returns the type used by the rest of the module.
const optionsSchema = z.strictObject({
  baseUrl: z.url(),
  token: z.string().optional(),
})

type Options = z.infer<typeof optionsSchema>

function parseOptions(value: unknown): Options {
  return optionsSchema.parse(value)
}
```

## Keep configuration construction obvious

- Resolve a fallback before the object when it has a default, repeats, or
  spans enough logic to hide the object shape.
- Pass optional typed properties directly when `undefined` is accepted. Do not
  add a spread, ternary object, or non-null assertion merely to omit a key.
- Name a configuration type when a multi-field shape crosses a function
  boundary. Do not create a type for a primitive or one-field bag.
- Centralize each default, allow-list, and error message with its owning rule.

```ts
// Avoid: repeated fallbacks and shape-changing spreads.
return createClient({
  timeoutMs: input.timeoutMs ?? defaults.timeoutMs ?? 3_000,
  ...(input.apiKey ? { apiKey: input.apiKey } : {}),
})

// Prefer: stable shape and named policy.
const timeoutMs = input.timeoutMs ?? defaults.timeoutMs ?? 3_000
return createClient({ timeoutMs, apiKey: input.apiKey })
```

## Preserve explicit ownership

- Resolve relative paths from an explicit project root. Do not use
  `process.chdir()` to make path behavior implicit.
- Pass an explicit option for production behavior. Do not compare a factory
  function by reference to infer whether code is in a default mode.
- Use the domain's durable identifier. Do not fall back from an ID to a display
  name unless that fallback is part of the contract.
- Reuse existing filename sanitizers, URI matchers, and `Bun.Glob` conventions.
  Parallel regex dialects drift and make security review harder.
- Remove unused parameters when a signature changes.
- Do not swallow validation failures with `catch`, logging, and continuation.

## Review the boundary

- Can invalid input reach a typed internal function?
- Is the schema more permissive or destructive than the public contract?
- Are defaults and optional-property semantics visible in one place?
- Does path resolution depend on hidden process state?
- Did the change introduce a second parser, matcher, sanitizer, or allow-list?
