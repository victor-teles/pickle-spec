# SauceDemo example

This project exercises the public [SauceDemo](https://www.saucedemo.com/)
practice storefront through one focused customer journey:

```text
Login → Products → Add backpack → Cart → Checkout
      → Customer information → Order confirmation
```

The example is split into four independent Specifications:

- Customer authentication covers successful, rejected, required-field, and
  logout paths.
- Product catalog covers inventory completeness, price sorting, and product
  details.
- Shopping cart covers adding, removing, and retaining products.
- Backpack checkout covers the complete journey through order confirmation.

SauceDemo publishes its practice credentials on the login page. The
Specifications use `standard_user` with `secret_sauce` and submit only dummy
customer information. Each Scenario starts in an isolated browser session, so
cart and checkout state do not leak between runs.

## Run the example

Set `GOOGLE_GENERATIVE_AI_API_KEY` in `apps/example/.env`, then run from the
repository root:

```sh
bun run run:example
```

The default command runs the two `@smoke` Scenarios. To run all authentication,
catalog, cart, validation, cancellation, and order paths:

```sh
cd apps/example
bun run run:regression
```

To run the complete journey directly from this project:

```sh
cd apps/example
bun run run:journey
```
