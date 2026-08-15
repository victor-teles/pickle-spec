# Derive identifiers unless the specification declares one

A specification, scenario, examples block, or examples row has an identifier so test results, execution plans, and history can attach to it. That identifier is derived from the specification URI and name, plus the scenario or examples name or examples row values, unless the source declares an explicit identifier.

Renaming a Feature or Scenario, moving a specification to another URI, copying a same-name scenario in the same specification, or changing an examples cell produces a new derived identifier. Editing steps or reordering examples rows does not. An explicit identifier is the only way to keep the previous identity across those changes. Step text stays out of the identifier because scenario revision already answers whether an execution plan still applies.

This supersedes ADR-0005, which required a random namespaced tag or `pickle_id` in source so identity would survive any edit.
