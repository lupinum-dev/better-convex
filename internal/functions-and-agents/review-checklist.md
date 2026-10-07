# Review checklist for the authorization path

Read this before you change row rules, operations, internal operations,
approvals, tools or the MCP door, and before you review such a change.

Between 2026-10-06 and 2026-10-07, the walking skeleton's stress test and
three Codex reviews of it (findings R11–R27 in its `STRESS.md`), a review
with three lenses of the packages, and three Codex reviews of the branch
found the problems below; two release reviews on 2026-10-07 added class 13. Almost every P1 and P2 belongs to one of these
classes. Codex round 4 added classes 10 and 11. Each class names the questions to ask, the bugs
that taught it, and the test that now guards it. The full list of
invariants is in `plan.md` section 6.

## 1. Authority that is not bound to one request

Authority that comes from a status or an ID, without proof that this exact
work is entitled to it, leaks to other work.

- R22: an internal operation accepted any approval ID that was pending.
  Fixed: authority only while `approve` runs the request (`executing`).
- Codex round 3: the one-hour window for follow-up work accepted any internal
  work of the same agent that named the approval ID. Fixed: work scheduled
  while the request runs gets a token recorded on the approval
  (`approvals.followUps`); only work that carries it continues.
- R20: in-app tool calls from a stale turn ran. Fixed: the current turn is
  required, only approved work is exempt.

Ask: who can produce this ID or flag, and does matching it prove that this
exact call is entitled? A requester key, a status or a time window alone does
not. Test: "work an approved request scheduled runs under the approval, for an
hour" (`packages/agents/test/approvals`).

## 2. A callback with more power than its job

A callback that only has to describe or decide must not be able to change
anything, and everything it reads must be visible to the checks that depend
on it.

- Codex round 1: approval summaries got the full mutation context, so a
  summary could write before anyone approved. Fixed: a read-only context, in
  the types and at runtime.
- Codex round 2: a summary could read through `ctx.runQuery`; those reads
  escaped the stale fingerprint. Fixed: no `runQuery` in summaries.
- R24: a summary that reached a raw function kept its writes. Fixed: the
  request fails as a whole.

Ask: what is the smallest context this callback needs? Can any read escape
the fingerprint or any write land before the decision? Tests: "an approval
summary cannot write, even when it hides the failure", "an approval summary
cannot run a nested query".

## 3. Shared mutable objects between the library and the handler

The rule checks judge rows from a per-call cache. If the handler gets the
same object, an edit to it changes what the next check sees.

- Codex round 1: a handler that read a row, edited the object and wrote it
  back passed an `allOf` rule that forbids writes to archived rows. Fixed:
  the cache keeps its own copy, handlers get copies (`copy` in `rules.ts`).

Ask: does any value cross from the library to app code and back to a check?
Test: "editing a row read by get/query does not change what the write rule
sees" (`packages/functions/test/rules.test.ts`).

## 4. Fail open on a value nobody expected

A decision function that returns something outside its type at runtime must
not count as "allow".

- Codex round 2: `(input) => decisions[input.mode]` returned `undefined` for
  an unknown mode, and the agent ran without approval. Fixed: anything that
  is not `allow`, `approve` or `deny` asks a person.
- Earlier: a rule that throws asks a person; an unknown role grants nothing
  (`toString`, `__proto__`, K1).
- Callback tables and the release review, 2026-10-07: a custom row rule, a
  `publicRead` condition and an agent rule of `null` each counted a truthy or
  empty value as allowed (an async condition returns a Promise, which is
  truthy). Fixed: only `true` allows; `null` asks a person.

Ask: what happens when this returns `undefined`, throws, or gets a prototype
key? Tests: "an agent rule that returns no decision asks a person"
(`policy.test.ts`), K1 in `shapes.test.ts`.

## 5. A bounded scan that makes a security decision

`take(n)` in a check means "the first n match", not "all match".

- Codex round 2: a declined call was looked up among the 20 oldest declines,
  so the 21st could ask again. Fixed: an index on a hash of the call
  (`by_requester_call`).
- R23, R27: housekeeping must page through every waiting run, with one fixed
  cutoff per sweep (Convex rejects a cursor from a different query).

Ask: is this check correct when there are more rows than the limit? Test: "a
declined call is found among more than 20 declines".

## 6. A generalisation that grants too much

A new "also allow X" path must be as narrow as the case that asked for it.

- Round 1 (packages): cross-tenant approvers counted every tenant whose rows
  a request only read. Fixed: opt-in (`approvers: { roles, sharedRows: true }`)
  and only rows the agent may change.
- Round 1: a request for a row the agent cannot read reached the other
  tenant's approval queue. Fixed: input rows are read through the checked db
  first.

Ask: which tenant gains a say, and would the slice that asked for this break
if the rule were narrower? Tests: the marketplace slice and the approvals
`sharedRows` tests.

## 7. A check on insert that is missing on update

- Round 1: a patch could move a nested tenant (a client) under an agency the
  actor has no role in. Fixed: a changed parent is checked like the parent of
  a new tenant (`assertParent`).
- R13: a nested mutation that changed memberships left stale roles in the
  caller's cache. Fixed: the cache is cleared after nested writes.

Ask: if a field matters on insert, is it checked when it changes?

## 8. Types that allow what the runtime refuses, and the reverse

- Round 1: `tenant()` on a field that holds no ID type-checked and hid every
  row. Fixed: rule fields must hold an ID.
- Docs-only slice: calling a job from an operation compiled and failed at
  runtime. Fixed: a `JobDone` mark in the job's return type; operation
  contexts refuse it with a message.
- V5: `export const fns = defineFunctions(...)` broke declaration emit
  (TS4023). Fixed: no unnamed symbols in public types. Test: the fixture app
  type-checks with `declaration: true`.

Ask: can a wrong call compile? Can a right call fail to compile in an app
that emits declarations? Tests: `packages/functions/test/types.test.ts`.

## 9. Test helpers and placeholders that reach production

- Codex round 3: `grantMcp` minted a live MCP grant under
  `NODE_ENV=production`. Fixed: `signInAs` and `grantMcp` refuse to run
  unless `VITEST` is set or `NODE_ENV` is `test`.
- The packed tarballs shipped the agent-docs placeholder. Fixed: `prepack`
  refuses it, and the packed checks look for the real page.
- Releases: packages at `0.0.0` would have been published with the next Nuxt
  release. Fixed: `scripts/release.mjs` skips them.

Ask: what happens if this runs, or ships, outside the place it was made for?

## 10. Credentials visible to app code

Anything that grants authority must stay inside the library's call wrappers.
App code stores and sends what it is given.

- Codex round 4: `ctx.actor` carried the approval ID and the follow-up token.
  An app that stored the actor (an "edited by" field) stored reusable
  authority. Fixed: handlers get the actor without them (`shown` in
  `functions.ts`).

Ask: if the app logs, stores or returns this object, what can someone do with
it? Test: "work an approved request scheduled runs under the approval, for an
hour" checks what the handler sees.

## 11. Read, change, write under concurrency

Two writes in one transaction that both read a list, add to it and write it
back lose one addition.

- Codex round 4: two `scheduler.runAfter` calls in `Promise.all` each appended
  a follow-up token to the approval; one token was lost and its job failed.
  Fixed: one token per approval, minted once by `approve`; scheduled work
  only reads it.

Ask: can two calls in the same transaction, or two transactions, interleave
here? Prefer a value that is written once over a list that grows.

## 12. A check on one branch that every branch needs

A guard written inside one branch of a decision protects only that branch.

- Sequence fuzz, 2026-10-07: the check that a `request_id` names one call ran
  only for calls that ask a person. A call that runs at once could reuse the
  key of a waiting request. Fixed: the check runs before the decision.
- Class 7 (insert versus update) is the same pattern for writes.

Ask: does this guard depend on the decision, or on the input? If on the
input, it belongs before the branch.

## 13. A check on the data instead of on what the person saw

An approval protects what the person was shown. A check that compares the
stored data can stay equal while the shown result changes.

- Release review, 2026-10-07: approve compared only the rows the summary had
  read, so a new row that matched the summary's query was archived too.
- Release review 2: approve compared raw rows, including rows the rules hid
  from the summary. When the agent got a role there, the hidden row became
  visible, its raw fingerprint stayed equal, and the approved work archived
  it. Fixed: the summary reads through a reader that records each row it is
  shown; approve runs the summary again and compares the two sets. A row
  that changed or went away fails as `STALE` before anything else runs.

Ask: what did the person see, and does the check compare exactly that,
under the rules that apply when the work runs? Tests: "approving checks
what the summary read, also new matches" and "approving checks what the
summary could not see" (`packages/agents/test/approvals`).

## Tools that find these classes

`pnpm test:mutants` proves that each guard has a test that fails without it.
The sequence fuzz (classes 1, 4, 5, 11, 12) and the callback tables (classes
2, 4, 10) find new instances; see testing-strategy.md, "Three more checks".
A new callback the library hands to app code gets a row in the callback
table; a new decision point gets a bad-value table.

## How to review a change here

1. Name the invariant the change touches (`plan.md` section 6). If it is
   new, add a row.
2. Walk the classes above for the changed code.
3. Write the regression test first, then fix. Every fixed finding adds that
   test and a row in `test/mutants/mutants.ts` whose `kills` names it. Prove
   the row with `pnpm test:mutants --only <id>`: the test must fail when the
   guard is broken. Twice in this work a test passed for the wrong reason: a
   nested query to a function that did not exist failed either way, and a
   `grantMcp` test ran with stubbed origins. Only the mutation check showed
   it.
4. Ask Codex for a review in the background (`codex-run review --base
origin/main --effort high`) with the fixed findings listed, so it looks for
   new ones. A round that finds only narrower edges of the last round's fixes
   is converging; a round with a new class is not.
