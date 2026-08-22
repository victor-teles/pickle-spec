# Reset pre-release run storage for Test evidence

Pickle Spec introduces the Test evidence model through a new test-run schema without migrating earlier development data or Run archives. The product is still pre-release, so developers remove the affected project's resolved local Test run directory under `PICKLE_HOME/projects/<project>/runs` manually before using the new schema. Studio and CLI report the exact resolved directory but do not delete it automatically or add a reset command.

This one-time development cutover is an explicit exception to ADR-0010's normal in-memory migration rule. After the Test evidence schema becomes the new baseline, later compatible schema migrations remain in-memory and never rewrite an imported archive. Test runs and Run archives created before this cutover are rejected without modification.
