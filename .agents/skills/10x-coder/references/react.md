# React quality guide

Read this guide whenever the touched code includes React or JSX. Follow the
repository's framework, design system, and server/client conventions first.

## Review order

1. Identify the component's single product responsibility and the state it
   owns.
2. Reduce state to the minimal source of truth; derive everything else during
   render.
3. Move user-triggered work into event handlers and reserve Effects for
   synchronization with systems outside React.
4. Make the render tree read like the product structure. Split independently
   meaningful regions when they have different data, behavior, or reasons to
   change.
5. Shape the component API through composition before adding modes and flags.
6. Check semantics, accessibility, async states, stable list keys, and focused
   verification.

## Keep components focused

- A component should represent one coherent product concept. Split a component
  when it owns unrelated workflow state, data access, and several UI regions
  that change independently.
- Use line count as a review trigger. Around 150 lines for a component or 200
  lines for a TSX module, stop and identify responsibilities. Keep it whole
  only when splitting would hide a cohesive render flow.
- Extract a child when it has a meaningful name, its own behavior or state, is
  reused, or lets the parent read as a short composition. Do not extract every
  wrapper or three-line fragment.
- Declare components at module scope. A component declared inside another
  component is recreated on every render and gives its state an unstable
  identity.
- Keep domain transformations and I/O outside the JSX. Prepare small named
  values before `return`; move reusable stateful behavior into a focused hook.
  Do not use a hook as a drawer for unrelated logic.

## Design small composable APIs

- Prefer `children`, named slots, and focused subcomponents over a growing set
  of boolean props such as `compact`, `withFooter`, `showIcon`, and
  `isDismissible`.
- Use explicit variants or discriminated unions when modes have different
  required data. Invalid prop combinations should be difficult to express.
- Keep public props at the consumer's level of intent. Do not expose internal
  state setters, styling switches, or transport details.
- Let wrappers accept JSX as children when the wrapper owns visual or local
  interaction state. This preserves composition and avoids needless knowledge
  of child internals.
- Prefer the repository's existing primitives and compound-component patterns.
  Do not create a parallel button, dialog, table, or form vocabulary.

```tsx
// ❌ modes accumulate and produce invalid combinations
<Notice
  compact
  showIcon
  showActions
  isLoading={false}
  isError
  errorMessage="Could not save"
/>

// ✅ the structure and state are explicit
<Notice variant="error">
  <Notice.Icon />
  <Notice.Content>Could not save</Notice.Content>
  <Notice.Actions>
    <Button onClick={retry}>Retry</Button>
  </Notice.Actions>
</Notice>
```

## Keep state minimal and owned once

- Store only information the UI must remember. Derive filtered collections,
  counts, labels, validation state, and other pure projections during render.
- Do not copy props into state to keep them "in sync." If the parent controls a
  value, accept the value and change callback. If the child owns it, keep it
  local.
- Give each state value one owner. Lift state only to the nearest common parent
  that must coordinate it; keep transient state such as hover, draft input, and
  disclosure local when no sibling needs it.
- Model mutually exclusive async or workflow states with a discriminated union
  or existing state model instead of several booleans that can contradict one
  another.
- Update objects and arrays immutably. Never mutate props or state during
  render.

```tsx
// ❌ duplicated source of truth and synchronization effect
const [visibleItems, setVisibleItems] = useState(items)
useEffect(() => {
  setVisibleItems(items.filter(item => item.name.includes(query)))
}, [items, query])

// ✅ derive during render
const visibleItems = items.filter(item => item.name.includes(query))
```

## Use Effects only for external synchronization

- Rendering must stay pure. Network calls, subscriptions, timers, DOM bridges,
  analytics, and imperative third-party APIs belong at an explicit boundary.
- Put work caused by a user action in that event handler. Do not set a flag and
  wait for an Effect to notice it.
- Do not use an Effect to derive state from props or other state. Compute the
  value during render, or reset identity deliberately with a key when the
  product behavior requires a fresh subtree.
- Include every reactive dependency. If the dependency list keeps growing,
  simplify ownership or move values inside the Effect instead of suppressing
  the rule.
- Always return cleanup for subscriptions, observers, and timers.

## Keep rendering predictable

- Use semantic elements and the repository's accessible primitives. Preserve
  keyboard behavior, focus management, labels, names, and announced async
  states.
- Use stable domain identifiers for list keys. Never use an array index when
  items can reorder, insert, or disappear, and never generate keys during
  render.
- Prefer clear early returns for mutually exclusive page-level states. Avoid
  deeply nested ternaries and long inline callbacks in JSX.
- Name handlers for the user intent (`handleRetry`, `handleNameChange`) and keep
  them near the state or action they coordinate.
- Keep server, loading, empty, error, and success ownership explicit. Do not
  blur backend state with local transition state.

## Optimize after correctness

- Treat `memo`, `useMemo`, and `useCallback` as performance tools, not default
  cleanliness. Add them when profiling or an established repository boundary
  shows meaningful repeated work or unstable props.
- Code must remain correct without memoization. Prefer local state, pure
  rendering, composition through children, and fewer Effect-driven update
  chains before adding caches.
- Do not create memoized objects or callbacks solely to silence an Effect. Move
  the object into the Effect or remove the unnecessary Effect when possible.

## Final React check

- Is the component's product responsibility clear from its name and render
  tree?
- Is every state value necessary, owned once, and impossible to derive?
- Is every Effect synchronizing with something outside React?
- Could composition replace boolean modes or an oversized prop object?
- Are meaningful regions split without creating wrapper-only fragments?
- Are semantics, focus, keyboard behavior, labels, keys, and async states
  correct?
- Is memoization justified by evidence or an established boundary?

These rules align with React's guidance on
[thinking in React](https://react.dev/learn/thinking-in-react),
[sharing state](https://react.dev/learn/sharing-state-between-components),
[avoiding unnecessary Effects](https://react.dev/learn/you-might-not-need-an-effect),
and using [memoization](https://react.dev/reference/react/useMemo) only as a
performance optimization.
