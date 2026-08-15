# Store immutable test runs as event streams

Each test run stores an append-only `events.ndjson` stream and a materialized `manifest.json`. The Studio updates live from the stream and can recover a partial run after interruption.

A rerun creates a new test run and links to its source run. It never changes prior results or artifacts.

A run archive transports one immutable test run between CI and the Studio. Import reads older schemas through in-memory migrations and never rewrites the archive.

The SQLite index remains a rebuildable query projection. It is not the source of truth for test runs.
