# CLI modernization verification

Recorded on 2026-08-30 in the repository root unless a package directory is stated.

- Baseline command: `bun run test` from `packages/cli`
  - Result: 175 tests passed in 209.16 seconds
  - Existing `test:remaining` portion: 203.82 seconds
- Fast lane command: `bun run test`
  - Result: all 7 Turborepo tasks passed
  - Final CLI result: 22 files and 91 tests passed in 4.91 seconds
  - Earlier uncontended CLI result before the last regression assertion: 22 files and 90 tests passed in 2.82 seconds
- Final CLI integration command: `bun run test:integration`
  - Confidentiality result: 1 file and 1 test passed in 2.28 seconds
  - Main result: 5 files passed, 1 skipped, 87 tests passed, and 2 skipped in 163.41 seconds
- Type check command: `bun run typecheck`
  - Result: all 7 Turborepo tasks passed
- Lint command: `bun run lint`
  - Result: exit code 0 with 50 pre-existing excessive-line warnings and no task-created warning
- Release validation command: `bun run release:check`
  - Result: all 7 workspace packages passed at version 1.0.2
- Focused CLI boundary command: `bun run --cwd packages/cli test:unit -- src/command-program.test.ts`
  - Final result: 1 file and 7 tests passed in 342 milliseconds

The full integration workflow found and drove two fixes before the final pass. Absent command filters had overwritten named-suite defaults, and splitting the executable temporarily removed its executable bit.
