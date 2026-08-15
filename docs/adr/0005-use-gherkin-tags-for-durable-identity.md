---
status: superseded by ADR-0011
---

# Use Gherkin tags for durable identity

Pickle Spec uses namespaced Gherkin tags as durable specification and scenario identifiers. Generated Cucumber IDs cannot identify history, test results, or execution plans because they change during parsing.

One feature file represents one specification. Its Feature node owns the specification identifier, and each Scenario node owns its scenario identifier.

Each Examples block owns an identifier. Each Examples row contains a reserved `pickle_id` column so history survives row reordering.

The Feature node also declares `draft`, `active`, or `deprecated` through a namespaced tag. Normal test runs select active specifications.

Namespaced link tags reference external requirements and issues. Project configuration maps each link namespace to its destination URL without synchronizing external state.

The Studio preserves source text and applies localized edits. It never reformats an entire feature file during a normal save.

`pickle migrate` previews and adds missing identifiers and states. Test runs report missing metadata but never modify feature files.
