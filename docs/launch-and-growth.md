# Pickle Spec launch and growth plan

Drafted on 2026-09-04. This plan proposes a focused technical preview followed
by a broader launch after external projects demonstrate repeat use. It is not
a claim that release gates have passed. Product priorities are in the
[QA and UX roadmap review](roadmap-qa-ux-review.md); package validation remains
owned by [Release validation](releasing.md).

## Audience and promise

Start with QA engineers, SDETs, and developers who own a small web regression
suite and can install a Bun project. The initial use case is a source-controlled
smoke journey whose failures need understandable, portable evidence.

Lead with web because it gives this campaign one setup path and one demonstration.
Offer a separate mobile track to teams with provisioned emulators or simulators.
This is a campaign choice, not a proposal to remove mobile support. Treat demand
from manual-only QA teams, large enterprises, and coding-agent users as hypotheses
to investigate before broadening the onboarding promise.

Suggested positioning:

> Write a Gherkin scenario, run it against your application, and inspect what
> happened in local Studio. Reuse applicable execution paths through Replay and
> take the failure evidence with you.

Explain the boundaries near the install instructions. Adaptive execution needs a
configured model provider and can incur provider charges. Applicable Replay runs
without model inference; cache-only mode fails on misses or divergence. Replay
does not guarantee a passing application. Local-first storage does not mean
configured model or remote-browser providers receive no data.

Avoid claims of zero flakiness, universal browser support, complete Cucumber
compatibility, perfect healing, or unique AI testing. Planned authoring and repair
must not appear as available features in launch copy.

## Maintenance feedback to validate

A QA engineer, through the project owner, asked for easy maintenance of the
AI-generated cached interactions, either manually or through autonomous repair.
The proposed product response is an editable execution plan linked to Gherkin
steps, with validated revisions and recoverable human changes. See the
[execution-plan review](roadmap-qa-ux-review.md#high-qa-needs-ownership-of-the-generated-execution-plan)
for the workflow and acceptance criteria.

Add a maintenance task to pilot interviews: change a UI interaction while keeping
the expected business outcome unchanged, then ask the participant to repair it.
Record whether they prefer manual editing, an AI proposal, or policy-controlled
autonomous repair, and why. Measure task completion, assistance, time to a
validated revision, and confidence explaining the change. Distinguish a
prototype session from a working released editor.

Manual execution-plan maintenance is a proposed core QA milestone. Broad launch
positioning around maintainability should wait for its acceptance checks. A
technical preview can still disclose the limitation. Do not advertise editable
plans or autonomous repair until the exact released workflow is verified.

Once available, demonstrate the complete loop: AI creates interactions, QA
corrects one, the Scenario validates without weakening its assertions, and
Replay uses the accepted revision. Test whether this helps activated projects
return after their application changes. One engineer's feedback justifies testing
this workflow, not claiming that every QA team wants autonomous changes.

## What counts as activation

Track the funnel by distinct external project, excluding internal fixtures and
maintainer demonstrations. Do not infer activation from package downloads.

| Stage | Evidence |
| --- | --- |
| Attention | A source-tagged visit or response; only a distribution signal |
| Setup started | A participant attempts installation in their own project |
| Ready | Target and configuration checks pass |
| First value | A real-application scenario with a meaningful assertion runs and the participant inspects its result |
| Activated | The participant also explains a deliberate failure and repeats an eligible scenario through Replay |
| Retained | The project runs again on a different day within seven days of activation |
| Expanded | The project adds a second meaningful journey or uses the suite in CI |

Record why a scenario is not Replay-eligible. Report those users' first value and
return behavior separately so the definition does not erase useful adoption.
Track assisted activation separately from unassisted activation. A copied example
is a demonstration completion, not an activated external project.

Start with a consent-based research log, using project aliases, source channel,
release, dates, stage reached, assistance, and blocker. No new hosted telemetry
is required. Do not collect application contents, credentials, or test artifacts
by default. Ask before retaining interview recordings or customer examples.

## Launch gates

The release owner records a pass, failure, or explicit limitation beside each
gate, with the exact revision and evidence location. An unchecked gate is pending.

- [ ] Run the required commands in the release guide and retain their output.
- [ ] Verify the intended published package version and dist-tag from a clean external project. Package packing alone does not prove registry installation works.
- [ ] Run the published README path through initialization, Studio, a real assertion, a deliberate failure, and evidence inspection.
- [ ] Verify Adaptive followed by applicable Replay, and cache-only miss behavior. Record inference counts without claiming unmeasured dollar savings.
- [ ] Complete the export/download/import handoff on another workspace or machine, with no original project access.
- [ ] Record live smoke evidence for every target advertised in this launch. Mark other targets unverified for this release or omit the claim.
- [ ] Publish prerequisites, provider-data boundaries, supported environments, and known limitations beside the quick start.
- [ ] Confirm package metadata, license terms, repository links, issue reporting, and install instructions for the release. This review did not establish published availability or license readiness.
- [ ] Complete the QA acceptance session in the companion review, including keyboard use, error recovery, and manual execution-plan maintenance. A preview without the editor must record that task as unavailable, not passed.
- [ ] Before advertising plan maintenance, verify manual edit, validation, activation, rollback, and preservation through refresh and cache eviction. Verify AI repair separately before advertising it.
- [ ] Assign someone to handle install failures and feedback during the launch window, with a documented workaround or previous-version recovery path.

A technical preview may proceed with disclosed limitations and assisted setup.
Defer broad promotion if the primary web path is broken, evidence is misleading,
regressions become passes, or external users cannot recover from common failures.
Do not delay the preview for AI authoring, autonomous repair, trends, or hosted
collaboration. Keep the manual-maintenance gap visible in preview limitations.

## Launch package

Use one tested scenario and one exact release across the assets. Prefer a small
application with login and one meaningful state change. Use synthetic data.

| Asset | Content | Completion check |
| --- | --- | --- |
| Quick start | Prerequisites, install, configure, run, inspect, repeat, troubleshooting | An external tester follows it without undocumented commands |
| Short demo | Gherkin, real execution, failed expectation, evidence, applicable Replay | Every displayed capability works on the named release; provider calls and edits are disclosed |
| Example repository | Small application, assertion, seeded failure, CI recipe | Clean checkout produces the documented outcomes |
| Failure report | Portable HTML and importable archive from the demonstration | Another person opens the report and explains the failure |
| Support matrix | Verified targets and task-level limitations | Each supported claim links to release evidence |
| Release notes | Available capabilities, exclusions, known issues, recovery instructions | Claims match the release and roadmap status |
| Feedback form or issue template | Task attempted, environment, version, expected/actual result, optional sanitized evidence | Reporter can describe a blocker without sending secrets |

Keep package ownership details available for library consumers. The launch
landing page should first explain the QA task, show the result, and provide the
verified install path. Use the repository's current package name,
`@pickle-spec/cli`, after checking the published artifact.

## Rollout sequence and ownership

One person may own several roles. Assign names before starting. The periods
below are proposed working windows, not release commitments.

| Window | Owner | Work and decision |
| --- | --- | --- |
| Preparation | Release owner | Complete package gates and the primary example; keep the launch date unset until blockers are understood |
| First pilot week | Product owner | Recruit five qualified external testers through existing contacts; observe the QA journey and record every blocker |
| Second pilot week | Product and release owners | Fix repeated blockers, retest, and check seven-day return behavior; decide whether to broaden the preview |
| Public preview week | Launch owner | Publish the tested quick start, example, demo, and limitations; remain available for support |
| Following four weeks | Product and launch owners | Run one acquisition experiment at a time, review weekly cohorts, and prioritize recurring activation or retention failures |

Outreach and publication are future owner actions. This document does not send
messages, publish posts, buy ads, or schedule campaigns.

## Distribution experiments

Start with existing contacts and one public channel. The following sample sizes
and decision rules are proposed learning thresholds, not forecasts. Small samples
provide qualitative direction, not reliable conversion benchmarks.

| Experiment | Hypothesis and asset | Measure and decision |
| --- | --- | --- |
| Assisted QA pilot | People maintaining smoke tests value clearer failure evidence; use the example plus a guided session | Five participants; if fewer than four finish the core journey, improve the repeated blocker before increasing traffic |
| Technical walkthrough | A concrete failure-to-diagnosis demo attracts qualified evaluators; publish one walkthrough on the channel where pilot users already participate | Track source to setup attempts and activation; after ten qualified attempts, compare blockers and returns with the pilot |
| Replay explanation | Explaining applicability and cache-only failure behavior reduces setup confusion; add one focused guide | Compare the next five sessions with the previous five; keep the guide if misunderstandings fall without new setup steps |
| Execution-plan maintenance | QA control over generated interactions helps projects survive application changes; use a working editor or an explicitly labeled prototype | Observe five maintenance sessions; assess the companion review criteria and seven-day return before making maintainability claims |
| CI recipe | Returning projects need unattended execution and portable failures; provide one tested workflow | Try it with three retained projects; prioritize CI work if at least two use it again without maintainer operation |
| Mobile pilot | Existing emulator users value the same evidence workflow; publish a separate target-specific example | Recruit three provisioned teams only after the web journey is stable; record target-specific blockers separately |

Possible public channels include a technical blog, existing QA communities,
LinkedIn, and Show HN. Choose from participant behavior rather than posting
identical content everywhere. Confirm each community's current rules before
posting. No paid acquisition budget is assumed; defer spending until unassisted
activation and repeat use are observable.

Show HN is suitable only once readers can try the product. Its official guidance
excludes landing pages alone and emphasizes accessible experimentation. Prepare
a working example and a factual founder explanation before choosing this channel.
[Show HN guidelines](https://news.ycombinator.com/showhn.html), checked 2026-09-04.

## Initial content sequence

Each item uses the same verified example and links to the next useful task.
Publish when its evidence is ready; this is not a daily posting obligation.

1. Show a real failed assertion and how Studio explains it. Invite readers to run the example.
2. Explain Adaptive, applicable Replay, and cache-only misses with recorded outcomes. Link the configuration recipe.
3. Walk through an authenticated journey with isolated test data. Ask evaluators which setup step blocked their own application.
4. Move a CI failure into local Studio and a portable report. Show what the recipient needs to open it.
5. Publish the most common pilot blocker, the change made, and its retest result. Use customer material only with permission.

For the first announcement, use this structure after verifying the release:

> Pickle Spec runs Gherkin scenarios against your application and keeps the run
> evidence in local Studio. This example shows a failed assertion, the step that
> produced it, and a report you can open separately. Applicable Replay reuses a
> stored execution path without model inference. The quick start lists the
> prerequisites and current limitations. We are looking for QA practitioners to
> try one real smoke journey and tell us where setup or diagnosis gets confusing.

Attach the actual quick-start and example links when published. Do not substitute
invented user counts, performance numbers, or testimonials for the demonstration.

## Weekly review

For each source and activation week, report setup attempts, ready projects,
first-value projects, activated projects, and seven-day retained projects as
counts and fractions. Calculate retention only for cohorts old enough to have a
full seven-day observation window. Record unknown follow-up outcomes separately.

Also report median setup time, total observed attempts, abandonment reasons,
assistance frequency, correct failure diagnoses, and support time per activated
project. With a small cohort, list individual timings rather than relying on
percentiles. Keep provider cost unknown unless measured; inference count is a
useful separate measure, not a dollar estimate.

Use the observed failure point to choose the next action:

- Attention without setup attempts calls for clearer positioning or a better-qualified audience.
- Setup attempts without first value call for installation, readiness, or example improvements.
- First value without return calls for interviews about real usefulness and maintenance burden.
- Return without expansion calls for examining data setup, authoring friction, and CI needs.
- Repeated successful independent use supports another distribution experiment.

Do not use stars, impressions, or downloads as substitutes for retained projects.
Pause a channel after two focused experiments yield no qualified setup attempts.
Keep support manageable before adding another channel.

## Decisions to revisit after the pilot

Decide whether the strongest demand is QA-led, developer-led, or coding-agent-led;
whether web and mobile need different onboarding; and which second journey users
actually add. Investigate willingness to pay only after repeated value is visible.
Do not invent pricing, a hosted service, or paid-tier boundaries to complete a
launch checklist.

The audience, channel choices, thresholds, and rollout windows are hypotheses.
Current repository documentation supports the product description, but no release
installation, live target run, user research, or growth result was verified as part
of writing this plan.
