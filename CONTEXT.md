# Pickle Spec

Pickle Spec is a test automation and management platform. It supports the full lifecycle of specifications, from authoring through execution and result review.

## Language

**Specification**:
A managed definition of expected product behavior. A specification contains one or more scenarios.
_Avoid_: Spec file, test file

**Scenario**:
A platform-independent example of expected product behavior within a specification.
_Avoid_: Test case, script

**Identifier**:
The durable identity of a specification, scenario, examples block, or examples row. Test results, execution cache entries, and history attach to this identity.
_Avoid_: Pickle ID, cucumber ID, test ID

**Derived identifier**:
The identifier computed from the specification URI and name, together with the scenario or examples name or examples row values, when no explicit identifier is declared.
_Avoid_: Implicit ID, automatic ID, content hash, natural key

**Explicit identifier**:
An identifier declared on a specification, scenario, examples block, or examples row that replaces the derived identifier.
_Avoid_: Manual ID, override ID, pinned ID

**Execution target**:
The product surface where a scenario runs, such as a web application or mobile application.
_Avoid_: Platform, engine, environment

**Test run**:
One execution of selected scenarios against an execution target.
_Avoid_: Execution, session, job

**Test result**:
The outcome and evidence produced for one scenario and execution target profile during a test run.
_Avoid_: Report, output, log

**Studio**:
The local interface for authoring specifications, managing test runs, and reviewing test results.
_Avoid_: Workbench, dashboard, report viewer, admin panel

**Execution cache**:
A local, reusable representation of the deterministic actions and verifications learned from a successful adaptive execution of a scenario against an execution target profile.
_Avoid_: Script, recording

**Adaptive mode**:
A test run mode that uses model inference to resolve and verify scenario behavior while the scenario runs.
_Avoid_: AI mode, exploration mode, dynamic mode

**Replay mode**:
A test run mode that uses an applicable execution cache without model inference.
_Avoid_: Adaptive mode, exploration mode

**Cache refresh**:
A user-requested Adaptive execution that bypasses the current execution cache entry and atomically replaces it only after the scenario succeeds.
_Avoid_: Forced Replay

**Cache-only**:
An execution setting that permits Replay mode but fails on a missing or divergent execution cache entry instead of using model inference.
_Avoid_: Offline mode

**Cache outcome**:
The classification of how an execution cache affected a test result, recorded separately from whether the scenario passed or failed.
_Avoid_: Test result state, cache status, execution mode

**Logical session**:
An isolated execution-target state that belongs to one scenario attempt.
_Avoid_: Browser, context, device session

**Execution target profile**:
A named configuration that selects an execution target and its required capabilities for a test run.
_Avoid_: Project, device profile, engine configuration

**Adaptive fallback**:
The observable transition from Replay mode to Adaptive mode after a cached execution diverges.
_Avoid_: Automatic fix

**Run event**:
A recorded state change within a test run.
_Avoid_: Log message, update, notification

**Specification state**:
The lifecycle classification of a specification: `draft`, `active`, or `deprecated`.
_Avoid_: Approval status, test status, publication state

**Test artifact**:
Evidence captured during a test run, such as a screenshot, trace, recording, or device log.
_Avoid_: Attachment, file, output

**Infrastructure error**:
A test result state caused by an unavailable or failed execution resource instead of product behavior.
_Avoid_: Test failure, broken test, runner crash

**Scenario revision**:
The content revision of a scenario used to determine whether an execution cache entry remains applicable.
_Avoid_: Scenario version, content hash, change ID

**Application revision**:
The identified state of the product under test during a test run.
_Avoid_: Build, commit, deployment version

**Flaky result**:
A test result that succeeds only after one or more failed attempts.
_Avoid_: Unstable test, intermittent pass, retried test

**Fast profile**:
An explicit execution profile that trades selected fidelity guarantees for lower test-run duration.
_Avoid_: Optimized mode, performance mode, quick run

**Rerun**:
A new test run created from selected results of an earlier test run.
_Avoid_: Retry, restart, updated run

**Resolved action**:
One execution-target operation derived from a scenario step.
_Avoid_: Command, instruction, substep

**Test suite**:
A named query that selects specifications and scenarios for a test run.
_Avoid_: Test collection, test set, folder

**Capability requirement**:
A capability that an execution target must provide before it can run a scenario.
_Avoid_: Device requirement, target constraint, prerequisite

**Run archive**:
A portable, immutable package containing one test run and its selected test artifacts.
_Avoid_: Report bundle, export file, test package

**External link**:
A reference from a specification or scenario to an item in another system.
_Avoid_: Requirement integration, tracker sync, issue binding
