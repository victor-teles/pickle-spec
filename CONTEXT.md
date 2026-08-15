# Pickle Spec

Pickle Spec is a test automation and management platform. It supports the full lifecycle of specifications, from authoring through execution and result review.

## Language

**Specification**:
A managed definition of expected product behavior. A specification contains one or more scenarios.
_Avoid_: Spec file, test file

**Scenario**:
A platform-independent example of expected product behavior within a specification.
_Avoid_: Test case, script

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

**Execution plan**:
A reusable sequence of resolved actions for one scenario and execution target.
_Avoid_: Script, recording, cache

**Adaptive mode**:
A test run mode that resolves scenario actions while the scenario runs.
_Avoid_: AI mode, exploration mode, dynamic mode

**Replay mode**:
A test run mode that uses an existing execution plan.
_Avoid_: Deterministic mode, recorded mode, cached mode

**Logical session**:
An isolated execution-target state that belongs to one scenario attempt.
_Avoid_: Browser, context, device session

**Execution target profile**:
A named configuration that selects an execution target and its required capabilities for a test run.
_Avoid_: Project, device profile, engine configuration

**Adaptation**:
The successful resolution of new actions after an execution plan cannot complete a scenario.
_Avoid_: Self-healing, automatic fix, fallback

**Candidate plan**:
An execution plan produced by an adaptation and awaiting explicit approval.
_Avoid_: Updated plan, healed plan, draft plan

**Run event**:
A recorded state change within a test run.
_Avoid_: Log message, update, notification

**Plan promotion**:
The explicit approval that replaces an execution plan with its candidate plan.
_Avoid_: Plan update, plan merge, accepting a fix

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
The content revision of a scenario used to determine whether an execution plan remains applicable.
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
