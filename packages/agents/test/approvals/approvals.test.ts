import { afterEach, beforeEach, expect, test, vi } from 'vitest'

import { api, caller, setup } from './harness'

// Approvals through the tool functions that the MCP door and the in-app agent call. Tests that
// need a running agent (resume after a decision) stay with the runtime. Each test names the
// STRESS.md row whose break it keeps fixed.

beforeEach(() => vi.useFakeTimers())
afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

const thirtyOneMinutes = 31 * 60_000

/** In-app agent runs that wait on these requests, as the runtime leaves them. */
async function waitingRuns(
  s: Awaited<ReturnType<typeof setup>>,
  approvalIds: string[],
  count: number,
) {
  return await s.t.run(async (ctx) => {
    const grantId = await ctx.db.insert('agentGrants', {
      authId: 'ann',
      userId: s.annId,
      agent: 'helper',
      scopes: ['projects:read'],
      expiresAt: Date.now() + 86_400_000,
    })
    const ids = []
    for (let i = 0; i < count; i++) {
      ids.push(
        await ctx.db.insert('agentRuns', {
          grantId,
          userId: s.annId,
          agent: 'helper',
          step: 'agent:step',
          task: `t${i}`,
          status: 'waiting',
          turn: 1,
          steps: 1,
          stepAt: Date.now(),
          approvalIds: approvalIds as never,
        }),
      )
    }
    return ids
  })
}

// C8 (other half): the same call twice must not ask the person twice.
test('the same call twice makes one request', async () => {
  const { t, p, approvalRows } = await setup()
  const call = { caller, input: { projectId: p[0] } }
  const first = await t.mutation(api.tools.archive_project, call)
  const second = await t.mutation(api.tools.archive_project, call)
  expect(second.approvalId).toBe(first.approvalId)
  expect(await approvalRows()).toHaveLength(1)
})

// I3: a retry key outlives an expired request, and replays the outcome after approval.
test('re-asking with the same request_id after expiry makes a new request; a retry then replays', async () => {
  const s = await setup()
  const first = await s.t.mutation(api.tools.archive_project, {
    caller,
    input: { projectId: s.p[0] },
    requestId: 'r1',
  })
  // V14: while the request waits, the key cannot name a different call either.
  await expect(
    s.t.mutation(api.tools.archive_project, {
      caller,
      input: { projectId: s.p[1] },
      requestId: 'r1',
    }),
  ).rejects.toThrow(/REQUEST_ID_REUSED/)
  vi.advanceTimersByTime(thirtyOneMinutes)
  const again = await s.t.mutation(api.tools.archive_project, {
    caller,
    input: { projectId: s.p[0] },
    requestId: 'r1',
  })
  expect(again.approvalId).not.toBe(first.approvalId)
  await s.ann.mutation(api.tools.approve, { approvalId: again.approvalId })
  const replay = await s.t.mutation(api.tools.archive_project, {
    caller,
    input: { projectId: s.p[0] },
    requestId: 'r1',
  })
  expect(replay).toEqual({ status: 'done', result: { id: s.p[0], status: 'archived' } })
  await expect(
    s.t.mutation(api.tools.archive_project, {
      caller,
      input: { projectId: s.p[1] },
      requestId: 'r1',
    }),
  ).rejects.toThrow(/REQUEST_ID_REUSED/)
})

// H11: one expired request blocked every later request for that action, for every later run.
test('an expired request blocks nothing, and housekeeping marks it expired', async () => {
  const { t, p, approvalRows } = await setup()
  await t.mutation(api.tools.archive_project, { caller, input: { projectId: p[0] } })
  vi.advanceTimersByTime(24 * 60 * 60_000)
  const next = await t.mutation(api.tools.archive_project, { caller, input: { projectId: p[1] } })
  expect(next.status).toBe('needs_approval')
  expect((await approvalRows()).map((row) => row.input.projectId)).toEqual([p[0], p[1]])

  await t.mutation(api.tools.housekeeping, {})
  expect((await approvalRows()).map((row) => row.status)).toEqual(['expired', 'pending'])
})

// I5: a large result made the approval row too big; the write committed and the request said "failed".
test('an approved request with a large result is approved, the result marked too large to keep', async () => {
  const s = await setup()
  const input = { projectId: s.p[0], size: 700_000, note: 'n'.repeat(400_000) }
  const asked = await s.t.mutation(api.tools.export_project, { caller, input })

  expect(await s.ann.mutation(api.tools.approve, { approvalId: asked.approvalId })).toEqual({
    status: 'approved',
  })
  const [approval] = await s.approvalRows()
  expect(approval).toMatchObject({ status: 'approved', result: { truncated: true } })
  expect(await s.t.run((ctx) => ctx.db.get(s.p[0]!))).toMatchObject({ name: 'exported' })
})

// A12: approving ran the stored input against whatever the row had become.
test('approving fails as STALE when the project changed after the request', async () => {
  const s = await setup()
  const asked = await s.t.mutation(api.tools.archive_project, {
    caller,
    input: { projectId: s.p[0] },
  })
  expect(asked.summary).toBe('Archive "alpha".')
  await s.t.run((ctx) => ctx.db.patch(s.p[0]!, { name: 'alpha (keep!)' }))

  const outcome = await s.ann.mutation(api.tools.approve, { approvalId: asked.approvalId })
  expect(outcome).toMatchObject({ status: 'failed', error: { code: 'STALE' } })
  expect(await s.t.run((ctx) => ctx.db.get(s.p[0]!))).toMatchObject({ status: 'active' })
})

// I2: only the requester's person could approve; a co-owner could not help.
test('a co-owner may decide a request through `approvers`; a viewer may not', async () => {
  const s = await setup()
  const asked = await s.t.mutation(api.tools.archive_project, {
    caller,
    input: { projectId: s.p[0] },
  })

  expect(await s.vic.query(api.tools.pending, { tenantId: s.a })).toEqual([])
  await expect(s.vic.mutation(api.tools.approve, { approvalId: asked.approvalId })).rejects.toThrow(
    /APPROVAL_NOT_FOUND/,
  )
  expect(await s.olga.query(api.tools.pending, {})).toEqual([])
  expect(await s.olga.query(api.tools.pending, { tenantId: s.a })).toMatchObject([
    { id: asked.approvalId, mine: false },
  ])
  expect(await s.olga.mutation(api.tools.approve, { approvalId: asked.approvalId })).toEqual({
    status: 'approved',
  })
  const [approval] = await s.approvalRows()
  expect(approval!.decidedBy).not.toBe(approval!.requester.userId)
})

// V3: approvers of a tenant decide a request only when every row it touches names that tenant.
test('an approver decides a request only when every row it touches is of the approver’s tenant', async () => {
  const s = await setup()
  const [shared, own] = await s.t.run(async (ctx) => [
    await ctx.db.insert('notes', { userId: s.annId, orgId: s.a, text: 'team' }),
    await ctx.db.insert('notes', { userId: s.annId, text: 'mine' }),
  ])
  const both = await s.t.mutation(api.tools.edit_notes, {
    caller,
    input: { texts: { [shared]: 'agent', [own]: 'agent' } },
  })
  const team = await s.t.mutation(api.tools.edit_note, {
    caller,
    input: { noteId: shared, text: 'agent' },
  })

  expect(await s.olga.query(api.tools.pending, { tenantId: s.a })).toMatchObject([
    { id: team.approvalId, mine: false },
  ])
  expect(await s.olga.query(api.tools.get, { approvalId: both.approvalId })).toBeNull()
  await expect(s.olga.mutation(api.tools.approve, { approvalId: both.approvalId })).rejects.toThrow(
    /APPROVAL_NOT_FOUND/,
  )
  expect(await s.olga.mutation(api.tools.approve, { approvalId: team.approvalId })).toEqual({
    status: 'approved',
  })
})

/** Org M, owned by Mallory, who has no role in A. */
async function otherOrg(s: Awaited<ReturnType<typeof setup>>) {
  const ids = await s.t.run(async (ctx) => {
    const mallory = await ctx.db.insert('users', { authId: 'mallory', active: true })
    const m = await ctx.db.insert('orgs', { name: 'M' })
    await ctx.db.insert('memberships', { orgId: m, userId: mallory, role: 'owner' })
    return { mallory, m }
  })
  return { ...ids, as: s.t.withIdentity({ subject: 'mallory' }) }
}

// Round 1 review: a row a request only reads made its tenant a party, so a seller approved a buyer agent's purchase.
test('a row a request only reads gives its tenant no say, even with sharedRows', async () => {
  const s = await setup()
  const m = await otherOrg(s)
  const listingId = await s.t.run((ctx) => ctx.db.insert('listings', { orgId: m.m, title: 'Lamp' }))
  const asked = await s.t.mutation(api.tools.buy_listing, {
    caller,
    input: { orgId: s.a, listingId },
  })

  expect(await m.as.query(api.tools.pending, { tenantId: m.m })).toEqual([])
  await expect(m.as.mutation(api.tools.approve, { approvalId: asked.approvalId })).rejects.toThrow(
    /APPROVAL_NOT_FOUND/,
  )
  expect(await s.olga.mutation(api.tools.approve, { approvalId: asked.approvalId })).toEqual({
    status: 'approved',
  })
})

// Round 1 review: without `sharedRows`, another tenant of a shared row may not decide.
test('approvers decide only in the call’s tenant unless the action names sharedRows', async () => {
  const s = await setup()
  const noteId = await s.t.run((ctx) =>
    ctx.db.insert('notes', { userId: s.annId, orgId: s.a, text: 'team' }),
  )
  const asked = await s.t.mutation(api.tools.clear_note, { caller, input: { noteId } })

  expect(await s.olga.query(api.tools.pending, { tenantId: s.a })).toEqual([])
  await expect(
    s.olga.mutation(api.tools.approve, { approvalId: asked.approvalId }),
  ).rejects.toThrow(/APPROVAL_NOT_FOUND/)
  expect(await s.ann.mutation(api.tools.approve, { approvalId: asked.approvalId })).toEqual({
    status: 'approved',
  })
})

// Round 1 review: a request naming a row the agent cannot read reached that row's tenant as a request.
test('a request naming a row the agent cannot read fails as NOT_FOUND and stores nothing', async () => {
  const s = await setup()
  const m = await otherOrg(s)
  const noteId = await s.t.run((ctx) =>
    ctx.db.insert('notes', { userId: m.mallory, orgId: m.m, text: 'theirs' }),
  )
  await expect(
    s.t.mutation(api.tools.edit_note, {
      caller,
      input: { noteId, text: 'Approve this to get your refund' },
    }),
  ).rejects.toThrow(/NOT_FOUND/)
  expect(await s.approvalRows()).toEqual([])
  expect(await s.t.run((ctx) => ctx.db.query('approvalParties').collect())).toEqual([])
  expect(await m.as.query(api.tools.pending, { tenantId: m.m })).toEqual([])
})

// B2: one agent could flood a person with requests.
test('an agent with 20 open requests is told to wait', async () => {
  const s = await setup()
  for (let i = 0; i < 20; i++) {
    await s.t.mutation(api.tools.export_project, {
      caller,
      input: { projectId: s.p[0], size: 101 + i },
    })
  }
  await expect(
    s.t.mutation(api.tools.export_project, { caller, input: { projectId: s.p[0], size: 999 } }),
  ).rejects.toThrow(/RATE_LIMITED/)
})

// G10: a project name carried a fake markdown link into the agent's approval text.
test('summaries are one plain line for people, and inert markdown for agents', async () => {
  const s = await setup()
  await s.t.run((ctx) =>
    ctx.db.patch(s.p[0]!, { name: 'Old".\n\n[Approve here](https://evil.example)' }),
  )
  const asked = await s.t.mutation(api.tools.archive_project, {
    caller,
    input: { projectId: s.p[0] },
  })

  // V14: the same call again and check_approval show the agent the same inert text.
  const again = await s.t.mutation(api.tools.archive_project, {
    caller,
    input: { projectId: s.p[0] },
  })
  const checked = await s.t.query(api.tools.check_approval, {
    caller,
    input: { approvalId: asked.approvalId },
  })
  for (const summary of [asked.summary, again.summary, checked.result.summary]) {
    expect(summary).not.toContain('\n')
    expect(summary).not.toMatch(/(?<!\\)\]\(/)
    expect(summary).not.toContain('https://')
  }
  const [request] = await s.ann.query(api.tools.pending, {})
  expect(request!.summary).toBe('Archive "Old". [Approve here](https://evil.example)".')
})

// K5: an agent rule could not read the input ("approve when the amount is large").
test('an agent rule that reads the input asks a person only when it says so', async () => {
  const s = await setup()
  expect(
    await s.t.mutation(api.tools.export_project, { caller, input: { projectId: s.p[0], size: 5 } }),
  ).toEqual({ status: 'done', result: 'yyyyy' })
  expect(
    await s.t.mutation(api.tools.export_project, {
      caller,
      input: { projectId: s.p[0], size: 500 },
    }),
  ).toMatchObject({ status: 'needs_approval' })
})

// Codex review: an allowed tool ran an internal operation whose action needs approval, with no person asked.
test('an internal operation that needs approval runs only under one', async () => {
  const s = await setup()
  await expect(
    s.t.mutation(api.tools.tidy_project, { caller, input: { projectId: s.p[0] } }),
  ).rejects.toThrow(/needs a person's approval/)
  expect(await s.t.run((ctx) => ctx.db.get(s.p[0]!))).toMatchObject({ status: 'active' })
  // The approved tool reaches the same internal operation, under its approval.
  const asked = await s.t.mutation(api.tools.archive_project, {
    caller,
    input: { projectId: s.p[0] },
  })
  expect(await s.ann.mutation(api.tools.approve, { approvalId: asked.approvalId })).toEqual({
    status: 'approved',
  })
  expect(await s.t.run((ctx) => ctx.db.get(s.p[0]!))).toMatchObject({ status: 'archived' })
})

// Codex review: only the first 50 rows were fingerprinted; a change to row 51 went unnoticed.
test('every row a request covers is checked for changes, up to a stated limit', async () => {
  const s = await setup()
  const ids = await s.t.run(async (ctx) => {
    const out = []
    for (let i = 0; i < 501; i++)
      out.push(await ctx.db.insert('projects', { orgId: s.a, name: `p${i}`, status: 'active' }))
    return out
  })
  const asked = await s.t.mutation(api.tools.archive_projects, {
    caller,
    input: { projectIds: ids.slice(0, 60) },
  })
  await s.t.run((ctx) => ctx.db.patch(ids[59]!, { name: 'changed' }))
  expect(await s.ann.mutation(api.tools.approve, { approvalId: asked.approvalId })).toMatchObject({
    status: 'failed',
    error: { code: 'STALE' },
  })
  await expect(
    s.t.mutation(api.tools.archive_projects, { caller, input: { projectIds: ids } }),
  ).rejects.toThrow(/TOO_LARGE/)
})

// Codex review: a retry after a large approved result failed on the result validator.
test('a retry after a large approved result replays the marker', async () => {
  const s = await setup()
  const asked = await s.t.mutation(api.tools.export_project, {
    caller,
    input: { projectId: s.p[0], size: 70_000 },
    requestId: 'big',
  })
  await s.ann.mutation(api.tools.approve, { approvalId: asked.approvalId })
  const replay = await s.t.mutation(api.tools.export_project, {
    caller,
    input: { projectId: s.p[0], size: 70_000 },
    requestId: 'big',
  })
  expect(replay).toEqual({ status: 'done', result: { truncated: true, bytes: expect.any(Number) } })
})

// A run stayed waiting forever when its wake-up was lost (live: runs from before the turn protocol).
test('housekeeping resumes a waiting run whose requests are all decided', async () => {
  const s = await setup()
  const asked = await s.t.mutation(api.tools.archive_project, {
    caller,
    input: { projectId: s.p[0] },
  })
  const [runId] = await waitingRuns(s, [asked.approvalId], 1)
  // The decision lands without its wake-up.
  await s.t.run((ctx) => ctx.db.patch(asked.approvalId, { status: 'declined' }))
  vi.advanceTimersByTime(2 * 60_000)
  await s.t.mutation(api.tools.housekeeping, {})
  expect(await s.t.run((ctx) => ctx.db.get(runId!))).toMatchObject({ status: 'running', turn: 2 })
})

// Second review: rows of `anyOf` tables were not fingerprinted; a pending edit overwrote a later change.
test('a request on a row of an anyOf table fails as STALE when that row changed', async () => {
  const s = await setup()
  const noteId = await s.t.run((ctx) =>
    ctx.db.insert('notes', { userId: s.annId, orgId: s.a, text: 'v1' }),
  )
  const asked = await s.t.mutation(api.tools.edit_note, {
    caller,
    input: { noteId, text: 'agent' },
  })
  await s.t.run((ctx) => ctx.db.patch(noteId, { text: 'v2 by a person' }))
  expect(await s.ann.mutation(api.tools.approve, { approvalId: asked.approvalId })).toMatchObject({
    status: 'failed',
    error: { code: 'STALE' },
  })
  expect(await s.t.run((ctx) => ctx.db.get(noteId))).toMatchObject({ text: 'v2 by a person' })
})

// Docs-only slice: approved work that scheduled its follow-up failed with APPROVAL_NOT_FOUND.
test('work an approved request scheduled runs under the approval, for an hour', async () => {
  const s = await setup()
  const asked = await s.t.mutation(api.tools.archive_later, {
    caller,
    input: { projectId: s.p[0] },
  })
  expect(await s.ann.mutation(api.tools.approve, { approvalId: asked.approvalId })).toEqual({
    status: 'approved',
  })
  await s.t.finishAllScheduledFunctions(vi.runAllTimers)
  expect(await s.t.run((ctx) => ctx.db.get(s.p[0]!))).toMatchObject({ status: 'archived' })
  const actingAs = { kind: 'agent', caller, approvalId: asked.approvalId }
  vi.advanceTimersByTime(61 * 60_000)
  await expect(
    s.t.mutation(api.ops.archiveRow, { actingAs, input: { projectId: s.p[1] } }),
  ).rejects.toThrow(/APPROVAL_NOT_FOUND/)
  expect(await s.t.run((ctx) => ctx.db.get(s.p[1]!))).toMatchObject({ status: 'active' })
})

// Second review: an internal operation accepted any still-pending approvalId as authority.
test('work refuses an approval that is not executing right now', async () => {
  const s = await setup()
  const asked = await s.t.mutation(api.tools.archive_project, {
    caller,
    input: { projectId: s.p[0] },
  })
  const actingAs = { kind: 'agent', caller, approvalId: asked.approvalId }
  await expect(
    s.t.mutation(api.ops.archiveRow, { actingAs, input: { projectId: s.p[1] } }),
  ).rejects.toThrow(/APPROVAL_NOT_FOUND/)
  expect(await s.t.run((ctx) => ctx.db.get(s.p[1]!))).toMatchObject({ status: 'active' })
  // V14: the same for a tool function handed a pending request as its approval.
  const noteId = await s.t.run((ctx) => ctx.db.insert('notes', { userId: s.annId, text: 'v1' }))
  const input = { noteId, text: 'agent' }
  const note = await s.t.mutation(api.tools.edit_note, { caller, input })
  await expect(
    s.t.mutation(api.tools.edit_note, {
      caller,
      input,
      approval: { id: note.approvalId, decidedBy: 'nobody' },
    }),
  ).rejects.toThrow(/APPROVAL_NOT_FOUND/)
  expect(await s.t.run((ctx) => ctx.db.get(noteId))).toMatchObject({ text: 'v1' })
})

// Round 1 review: approving replayed the request's 10-minute access token, so a later approval failed.
test('a person may approve after the access token that asked has expired', async () => {
  const s = await setup()
  const tenMinutes = { ...caller.principal, expiresAt: Math.floor(Date.now() / 1000) + 600 }
  const asked = await s.t.mutation(api.tools.archive_project, {
    caller: { door: 'mcp', principal: tenMinutes },
    input: { projectId: s.p[0] },
  })
  vi.advanceTimersByTime(11 * 60_000)
  expect(await s.ann.mutation(api.tools.approve, { approvalId: asked.approvalId })).toEqual({
    status: 'approved',
  })
  expect(await s.t.run((ctx) => ctx.db.get(s.p[0]!))).toMatchObject({ status: 'archived' })
})

// V14: the in-app door checked the run, not the grant; a revoked grant must stop a running run's tools.
test('revoking an in-app agent stops its tools, even while its run runs', async () => {
  const s = await setup()
  const { grantId, runId } = await s.t.run(async (ctx) => {
    const grantId = await ctx.db.insert('agentGrants', {
      authId: 'ann',
      userId: s.annId,
      agent: 'helper',
      scopes: ['projects:write'],
      expiresAt: Date.now() + 86_400_000,
    })
    const runId = await ctx.db.insert('agentRuns', {
      grantId,
      userId: s.annId,
      agent: 'helper',
      step: 'agent:step',
      task: 'rename',
      status: 'running',
      turn: 1,
      steps: 1,
      stepAt: Date.now(),
    })
    return { grantId, runId }
  })
  const rename = (name: string) =>
    s.t.mutation(api.tools.rename_project, {
      caller: { door: 'app', runId, turn: 1 },
      input: { projectId: s.p[0], name },
    })
  await rename('before')
  await s.t.run((ctx) => ctx.db.patch(grantId, { revokedAt: Date.now() }))
  await expect(rename('after')).rejects.toThrow(/AGENT_DISABLED/)
  expect(await s.t.run((ctx) => ctx.db.get(s.p[0]!))).toMatchObject({ name: 'before' })
})

// Second review: the waiting-run backstop stopped after 200 runs until the next hourly cron.
test('housekeeping goes through every waiting run, in batches', async () => {
  const s = await setup()
  await waitingRuns(s, [], 201)
  vi.advanceTimersByTime(2 * 60_000)
  await s.t.mutation(api.tools.housekeeping, {})
  // Third review: the continuation keeps the first transaction's cutoff, or Convex rejects its cursor.
  const [next] = (
    await s.t.run((ctx) => ctx.db.system.query('_scheduled_functions').collect())
  ).filter((job) => job.name === 'tools:housekeeping')
  expect(next!.args[0]).toMatchObject({ waiting: expect.any(String), cutoff: Date.now() - 60_000 })
  await s.t.mutation(api.tools.housekeeping, next!.args[0])
  const waiting = await s.t.run((ctx) =>
    ctx.db
      .query('agentRuns')
      .withIndex('by_status', (q) => q.eq('status', 'waiting'))
      .collect(),
  )
  expect(waiting).toEqual([])
})

// Third review and Codex round 1: a summary wrote before anyone approved (through a raw mutation, or ctx.db.patch).
test('an approval summary cannot write, even when it hides the failure', async () => {
  const s = await setup()
  await s.t.mutation(api.tools.sneaky_archive, { caller, input: { projectId: s.p[0] } })
  await s.t.finishAllScheduledFunctions(vi.runAllTimers)
  expect(await s.t.run((ctx) => ctx.db.get(s.p[0]!))).toMatchObject({ status: 'active' })
})

// Codex round 2: rows a summary read through ctx.runQuery escaped the stale check.
test('an approval summary cannot run a nested query, so no request skips the stale check', async () => {
  const s = await setup()
  await expect(
    s.t.mutation(api.tools.querying_archive, { caller, input: { projectId: s.p[0] } }),
  ).rejects.toThrow()
  expect(await s.approvalRows()).toEqual([])
})

// Third review: IDs used as record keys were not fingerprinted.
test('a request naming rows as record keys fails as STALE when one changed', async () => {
  const s = await setup()
  const noteId = await s.t.run((ctx) => ctx.db.insert('notes', { userId: s.annId, text: 'v1' }))
  const asked = await s.t.mutation(api.tools.edit_notes, {
    caller,
    input: { texts: { [noteId]: 'agent' } },
  })
  await s.t.run((ctx) => ctx.db.patch(noteId, { text: 'v2 by a person' }))
  expect(await s.ann.mutation(api.tools.approve, { approvalId: asked.approvalId })).toMatchObject({
    status: 'failed',
    error: { code: 'STALE' },
  })
})

// E15 (every code tested): a request nobody decided in time must not run when someone approves it late.
test('approving an expired request is refused and changes nothing', async () => {
  const s = await setup()
  const asked = await s.t.mutation(api.tools.archive_project, {
    caller,
    input: { projectId: s.p[0] },
  })
  vi.advanceTimersByTime(thirtyOneMinutes)
  await expect(s.ann.mutation(api.tools.approve, { approvalId: asked.approvalId })).rejects.toThrow(
    /APPROVAL_EXPIRED/,
  )
  expect(await s.t.run((ctx) => ctx.db.get(s.p[0]!))).toMatchObject({ status: 'active' })
})

// E15 (every code tested): a retry after a decline must replay the decline, not ask again.
test('a retry after a decline is told it was declined', async () => {
  const s = await setup()
  const call = { caller, input: { projectId: s.p[0] }, requestId: 'r2' }
  const asked = await s.t.mutation(api.tools.archive_project, call)
  await s.ann.mutation(api.tools.decline, { approvalId: asked.approvalId })
  await expect(s.t.mutation(api.tools.archive_project, call)).rejects.toThrow(/APPROVAL_DECLINED/)
  // Round 1 review: the same call without a request_id asked the person again.
  await expect(
    s.t.mutation(api.tools.archive_project, { caller, input: { projectId: s.p[0] } }),
  ).rejects.toThrow(/APPROVAL_DECLINED/)
  expect(await s.approvalRows()).toHaveLength(1)
})

// Codex round 2: only the 20 oldest declines were checked, so the 21st call could ask again.
test('a declined call is found among more than 20 declines', async () => {
  const s = await setup()
  const ask = (size: number) =>
    s.t.mutation(api.tools.export_project, { caller, input: { projectId: s.p[0], size } })
  for (let size = 101; size <= 121; size++) {
    const asked = await ask(size)
    await s.ann.mutation(api.tools.decline, { approvalId: asked.approvalId })
  }
  await expect(ask(121)).rejects.toThrow(/APPROVAL_DECLINED/)
})

// Without retention the activity log grew forever; it is the audit record, so it stays a year.
test('housekeeping keeps agent activity for a year, then deletes it', async () => {
  const s = await setup()
  await s.t.mutation(api.tools.rename_project, { caller, input: { projectId: s.p[0], name: 'n' } })
  const activity = () => s.t.run((ctx) => ctx.db.query('activity').collect())
  expect(await activity()).toHaveLength(1)
  vi.advanceTimersByTime(364 * 86_400_000)
  await s.t.mutation(api.tools.housekeeping, {})
  expect(await activity()).toHaveLength(1)
  vi.advanceTimersByTime(2 * 86_400_000)
  await s.t.mutation(api.tools.housekeeping, {})
  expect(await activity()).toEqual([])
})

// B1: one connection could make 300 writes a minute; same-row bursts surfaced as "the tool failed".
test('an agent may make 60 writes a minute, then waits', async () => {
  const { t, p } = await setup()
  const rename = (name: string) =>
    t.mutation(api.tools.rename_project, { caller, input: { projectId: p[0], name } })
  for (let i = 0; i < 60; i++) await rename(`n${i}`)
  await expect(rename('one more')).rejects.toThrow(/RATE_LIMITED/)
  expect(await t.run((ctx) => ctx.db.get(p[0]!))).toMatchObject({ name: 'n59' })
  vi.advanceTimersByTime(60_000)
  await rename('next minute')
  expect(await t.run((ctx) => ctx.db.get(p[0]!))).toMatchObject({ name: 'next minute' })
})
