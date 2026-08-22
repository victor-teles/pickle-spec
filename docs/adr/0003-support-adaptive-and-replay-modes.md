---
status: superseded by ADR-0012
---

# Support Adaptive and Replay modes

Pickle Spec supports Adaptive mode for resolving actions and Replay mode for repeatable test runs. Execution plans remain reviewable files under `.pickle/plans/`.

An adaptation creates a candidate plan instead of changing an approved plan. The test result records `passed-with-adaptation`, and the CI policy decides whether to accept that state.

The runner selects Adaptive mode when no approved plan exists and Replay mode when one exists. A plan is valid for one scenario revision, target profile, plan-format version, and application revision.

The Studio can use Replay with an unknown application revision and records a warning. CI requires an explicit application revision for Replay.

The runner retries infrastructure errors by default. Functional failures require an explicit retry policy, and a later success records a flaky result.

An execution plan belongs to one execution target profile and cannot cross execution targets. A scenario step can contain multiple resolved actions, which the plan stores and replays separately.

Approved execution plans belong in Git. Candidate plans remain local until plan promotion replaces an approved plan.
