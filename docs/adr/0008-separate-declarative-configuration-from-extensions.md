# Separate declarative configuration from extensions

`pickle.config.jsonc` stores target profiles, execution policies, paths, and retention settings. The Studio can edit this declarative file without rewriting executable code.

`pickle.extensions.ts` imports custom adapters and hooks. The runner combines both files and validates the result against a versioned schema.

Named test suites live in `pickle.config.jsonc` as saved selection queries. They do not store copied specification or scenario identifiers.
