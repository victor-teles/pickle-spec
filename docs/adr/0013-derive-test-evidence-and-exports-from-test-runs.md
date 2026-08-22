# Derive test evidence and exports from immutable test runs

The versioned, immutable test run is the sole source for live and historical Test evidence and every Test run export. The runner records the time and scope of Run events, Scenario attempts, steps, Diagnostic entries, and Test artifacts; execution-target adapters capture only the evidence their declared capabilities support. Evidence availability records why each evidence kind is present or absent. Studio projects one Test result inspector from that model instead of maintaining a separate report model.

The Evidence persistence policy controls which temporary diagnostics and artifacts become part of the test run. Retention deletes complete, unpinned test runs and never edits retained runs. Pinning is explicit; exporting a test run neither mutates nor pins it.

Exporters are projections of the same test run and may emit multiple formats without becoming import sources. The built-in Allure exporter writes the raw, cross-version `allure-results` directory without bundling an Allure renderer, history manager, or runtime dependency. It maps the durable Scenario Identifier to `testCaseId`, the Scenario, Examples row, and execution target profile to `historyId`, and each Scenario attempt to a separate result with steps, metadata, and selected Test artifacts as attachments.

Each requested export has an independent Test run export outcome. Exporters publish through a temporary destination and refuse to replace an existing destination without explicit confirmation. A failed export does not alter the test run or remove successful sibling exports, but the requesting command fails because it did not produce every requested deliverable.
