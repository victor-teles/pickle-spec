# Pool resources and isolate logical sessions

The runner schedules scenarios across the complete test run instead of scheduling one Feature at a time. It reuses expensive execution resources while creating a new logical session for every scenario attempt.

The scheduler uses historical scenario durations to balance shards when history exists. It uses deterministic scenario counts when no history exists.

The web adapter pools browser processes and creates an isolated browser context for each attempt. The mobile adapter leases a simulator session and performs a verified app reset.

The Studio can keep execution resources warm between test runs. It closes idle resources after a configured timeout.

The web adapter delays initial navigation until a scenario requires it. An explicit navigation step takes precedence over the target profile's base URL.

An adapter returns an infrastructure error when it cannot establish isolation. It never falls back to partial cleanup.
