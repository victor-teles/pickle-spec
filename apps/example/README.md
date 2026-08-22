# Automation Exercise example

This project models the 26 scenarios in the public
[Automation Exercise test-case catalog](https://automationexercise.com/test_cases).
The Specifications are grouped by customer accounts, engagement, catalog,
cart, and checkout.

## Run the read-only example

Set `GOOGLE_GENERATIVE_AI_API_KEY` in `apps/example/.env`, then run from the
repository root:

```sh
bun run run:example
```

The default command selects only scenarios tagged `@smoke`. These scenarios
navigate, search, and inspect the public catalog without submitting forms or
creating public data.

## Run the complete catalog

```sh
cd apps/example
bun run run:catalog
```

The complete catalog is intentionally not the default. Scenarios tagged
`@external-write` may register or delete accounts, submit contact details,
subscribe email addresses, publish reviews, or place practice orders on the
public service. Use disposable data and run them individually when their
preconditions are available.

Additional tags document required setup:

- `@automation-exercise:<number>` links a Scenario to its source catalog entry.
- `@requires-account` needs a disposable, pre-registered customer account.
- `@requires-upload` needs a harmless local file for the contact form.
- `@payment` uses the practice checkout flow; never enter real payment data.
- `@downloads-file` writes an invoice to the browser download directory.
