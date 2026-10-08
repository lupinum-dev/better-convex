# Experiments and verdicts

What we tried, what we chose, and what would make us look again. Decisions
with lasting effect are also in `internals/decisions.md` (D31–D36); this file keeps the
evidence and the alternatives so nobody has to repeat the experiment.

## The design holds on three app shapes

Three slices were built on the library alone, each from a real app's
feature, each with a leak test. They now run as packed consumer apps in
`test/fixtures/consumers/`, with the docs-only slice as `sites`:

| Slice                                     | Shape                       | What it forced into the library                                                                                                     |
| ----------------------------------------- | --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| Agency (website-checker3 `get_fix_brief`) | agency → clients → projects | Nothing new: `tenant('_id', { parent })` and `roleOf` across two levels worked as built                                             |
| Content (ginko-cms page read and edit)    | public pages and editors    | `allOf` (a state condition in the row rule, not in each handler)                                                                    |
| Marketplace (orders)                      | two parties share one row   | `RuleCtx.tenant`; FORBIDDEN instead of NOT_FOUND for a readable row the actor may not change; cross-tenant approvers (`sharedRows`) |

The three-applications rule of `AGENTS.md` is met by these slices (D31).

## A developer can build from the docs alone

A fresh agent built website-checker's `trigger_site_check` from the docs, the
starter and the type declarations only, in about 30 minutes. Typecheck was
green on the first try and every docs sample compiled. Its friction list
became fixes: approved work could not schedule follow-ups (fixed: the
follow-up token, class 1 in review-checklist.md), no one-line MCP grant for
tests (`grantMcp`), fake timers broke sessions (testing page), job calls from
operations compiled (now a type error), agent docs shipped as placeholders
(packaging). Repeat this test after any large API change: it found gaps that the
reviews did not.

## Keep our in-app agent runtime (not `@convex-dev/agent`)

Spike (`bc-skeleton/labs/spike-agent`, 13 tests): the same agent on
`@convex-dev/agent` 0.7.3 and `@convex-dev/workflow` 0.4.8.

- The components do not remove our run state: the tool layer checks each call
  against its run (live, grant valid, current turn), and approvals wake runs.
- They add about 24,000 lines in four components (agent 16,033, workflow
  3,902, workpool 3,304, batch-worker 1,006), four schemas per deployment and
  `react` as a peer.
- They cost about ten times more function runs and writes per run.
- Their approval flow (the approved tool runs later, as the agent) cannot
  replace ours (the call runs in the approver's transaction, with the stale
  check, the same at the MCP door).
- A run whose workflow waits for an event that never comes could not be ended
  cleanly by our housekeeping.

Look again when a feature needs streamed text or thread search in the UI, and
then try `@convex-dev/agent` alone behind our loop. The runtime stays out of
the packages until then (P5); it uses `./internal` of both packages.

## Package boundary: agents are actors in the core (D35)

The core package holds the agent tables, because it resolves the actor on
every call and its row rules must keep app handlers out of those tables.
Alternatives rejected: a plugin hook that lets `-agents` register its tables
and an actor resolver (an extra setup step in every app, and a new seam in the
authorization path, for purity alone); one package with subpaths (undoes the
split, with no gain). `agentRuns` and `agentMessages` move with the runtime
when it becomes a package.

## Optimisations we did not make (D36)

| Idea                                                                   | Why not                                                                                                                                                                       |
| ---------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Drop the door's live grant check and check only inside the transaction | The check came from the query cache in 67 of 77 calls. Removing it needs a new public option and removes a defence for apps that use `handleMcpRequest` with their own tools. |
| One combined grant row (W6)                                            | Derived data in the authorization path, to save reads the cache already saves.                                                                                                |
| Merge the double session and user read in the token refresh            | About two cached calls per 15 minutes, in the most sensitive auth path.                                                                                                       |
| Longer token lifetime                                                  | Not simpler: sign-out and suspension would take effect later.                                                                                                                 |
| Skip the organisation read when a membership exists                    | One small read, for coupling two checks.                                                                                                                                      |

Revisit any of these only with a measurement that shows a real latency or
cost problem (measurements.md has the baseline).

## Smaller decisions with their reason

| Decision                                                                                     | Reason                                                                                                                                                                                   |
| -------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Limits are constants, not options (`limits` removed in A1)                                   | No test or slice asked for an override. Add one with the slice that needs it.                                                                                                            |
| An approval gives authority for one hour to the work its request scheduled, bound by a token | The core use case (approved paid check → action → record result) failed without it; the token keeps other work out (review-checklist.md, class 1). One hour is a judgement, not derived. |
| Retention: activity 365 days, decided requests 90, finished runs 30                          | The activity log is the audit record; a decided request is covered by its activity row; run messages were working memory.                                                                |
| `signInAs` and `grantMcp` only under a test runner                                           | They write auth rows without the sign-in or consent flow.                                                                                                                                |
| Each package release waits for its first changeset (`0.0.0` is skipped)                      | Otherwise the next Nuxt release would publish them at `0.0.0` and fail on the npm name check (D34).                                                                                      |
| The skeleton's approval page shows the normal sign-in prompt after a sign-out elsewhere (J4) | The page shows no stale data and offers the way back; a separate "session ended" text there is app copy, not library behaviour.                                                          |

## Still open

| Item                                                                         | Next step                                |
| ---------------------------------------------------------------------------- | ---------------------------------------- |
| B11: one shared sign-in rate limit for many clients behind one IP?           | Repeat from a second public IPv4 network |
| The follow-up token (`crypto.randomUUID` in a mutation) on a real deployment | Check on the next deploy                 |
| A parent tenant cannot list the pending requests below it (V4)               | After 1.0, if an agency app needs it     |
| The docs build sometimes leaves raw pages out                                | Fix in progress at the time of writing   |
