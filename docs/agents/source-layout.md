# Source layout

Organize source by the product context that owns the behavior. Keep package
composition roots shallow, colocate tests with the module they exercise, and
avoid catch-all `utils` or `common` folders.

| Package | Context folders |
| --- | --- |
| `spec` | `authoring`, `identity`, `parsing`, `selection` |
| `runner` | `benchmarking`, `configuration`, `evidence`, `execution`, `execution-cache`, `exports`, `results`, `storage` |
| `web` | `adapter`, `benchmarking`, `evidence`, `execution-cache` |
| `mobile` | `adapter`, `agent-device`, `benchmarking`, `execution-cache`, `worker` |
| `cli` | `configuration`, `execution-cache`, `extensions`, `run`, `server`, `studio`, `terminal`, `workspace` |
| `studio` | `app`, `authoring`, `components`, `hooks`, `runs`, `server`, `settings` |

The package entry files are compatibility seams. Move implementations behind
those interfaces without requiring callers to learn internal paths.

## Shared code

Extract code across packages only when the copies express one rule that must
change together and at least two packages already use it. Prefer a focused
package named for the owning context over a generic shared package.

`@pickle-spec/configuration` owns the common grammar for strict configuration
objects and field validation. Domain schemas remain in the package that owns
their types.
