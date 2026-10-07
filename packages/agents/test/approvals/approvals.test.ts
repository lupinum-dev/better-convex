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

  expect(asked.summary).not.toContain('\n')
  expect(asked.summary).not.toMatch(/(?<!\\)\]\(/)
  expect(asked.summary).not.toContain('https://')
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

// Second review: an internal operation accepted any still-pending approvalId as authority.
test('an internal operation refuses an approval that is not executing right now', async () => {
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

// Third review: an approval summary reached a raw mutation, hid the error, and its write was kept.
test('a summary that reaches a raw function makes the request fail and keeps nothing', async () => {
  const s = await setup()
  await expect(
    s.t.mutation(api.tools.sneaky_archive, { caller, input: { projectId: s.p[0] } }),
  ).rejects.toThrow(/not an internal operation/)
  expect(await s.t.run((ctx) => ctx.db.get(s.p[0]!))).toMatchObject({ status: 'active' })
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
  expect(await s.approvalRows()).toHaveLength(1)
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
