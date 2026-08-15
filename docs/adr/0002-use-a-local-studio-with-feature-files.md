# Use a local Studio with feature files

Pickle Spec starts as a local Studio, while preserving a path to hosted synchronization. Feature files remain the source of truth for specifications and Git-based collaboration.

Git and pull requests provide collaboration and review in the first version. The Studio does not duplicate repository permissions, comments, or approvals.

The Studio can show diffs, stage files, and create local commits after confirmation. It never pushes automatically.

`pickle studio` provides authoring, test-run management, and result review. `pickle run` supports non-interactive execution and can export a self-contained HTML report.

The HTML export includes failure and adaptation artifacts by default. An explicit option includes all artifacts.

The Studio stores test runs under `.pickle/runs/<run-id>/`. A rebuildable SQLite index supports queries without becoming the source of truth.

The first version documents future hosted synchronization but contains no cloud API or synchronization implementation.

The Studio binds to `127.0.0.1`, validates request origins, and requires a session token. Remote access requires an explicit option and warning.
