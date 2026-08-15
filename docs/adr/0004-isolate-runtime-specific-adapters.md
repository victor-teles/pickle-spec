# Isolate runtime-specific adapters

The runner, CLI, and Studio use Bun. An adapter that requires another runtime executes behind a versioned process protocol.

The mobile adapter uses a Node worker for the `agent-device` client. The worker returns Pickle Spec events and never exposes `agent-device` types.
