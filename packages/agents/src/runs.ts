import type { LibraryDataModel } from '@lupinum/better-convex-functions/internal'
import { makeFunctionReference, type GenericMutationCtx } from 'convex/server'
import type { GenericId } from 'convex/values'

/**
 * Where an in-app agent run stands, shared by the agent, the approval
 * functions and housekeeping. A run moves
 * `running → (waiting → running)* → done | failed`; each scheduled step
 * carries a turn number, and only the current turn may start and save, so a
 * late or duplicate step does nothing.
 */

type Db = GenericMutationCtx<LibraryDataModel>['db']
type Scheduler = GenericMutationCtx<LibraryDataModel>['scheduler']
type Run = LibraryDataModel['agentRuns']['document']

/** A running run whose step has not saved for this long has stalled: Convex ends actions after 10 minutes. */
export const stallAfter = 15 * 60_000

/** True when every request is decided or expired. */
async function allDecided(db: Db, approvalIds: readonly string[]) {
  for (const id of approvalIds) {
    const row = await db.get(id as GenericId<'approvals'>)
    if (row?.status === 'pending' && row.expiresAt > Date.now()) return false
  }
  return true
}

/** Schedules the run's next turn; the step finds it `running` with this turn. */
export async function nextTurn(db: Db, scheduler: Scheduler, run: Run) {
  const turn = run.turn + 1
  await db.patch(run._id, { status: 'running', turn, stepAt: Date.now(), approvalIds: undefined })
  await scheduler.runAfter(0, makeFunctionReference<'action'>(run.step), { runId: run._id, turn })
}

/** A waiting run continues once its last request is decided or expired. Called on every decision and at expiry. */
export async function wake(db: Db, scheduler: Scheduler, runId: string) {
  const id = db.normalizeId('agentRuns', runId)
  const run = id && (await db.get(id))
  if (run?.status !== 'waiting') return
  if (!(await allDecided(db, run.approvalIds ?? []))) return
  await resume(db, scheduler, run, run.approvalIds ?? [])
}

/** Tells the model which requests were decided, then schedules the next turn. */
export async function resume(
  db: Db,
  scheduler: Scheduler,
  run: Run,
  approvalIds: readonly string[],
) {
  const last = await db
    .query('agentMessages')
    .withIndex('by_run', (q) => q.eq('runId', run._id))
    .order('desc')
    .first()
  const note = `Requests ${approvalIds.join(', ')} were decided. Check each with check_approval, then continue.`
  await db.insert('agentMessages', {
    runId: run._id,
    order: (last?.order ?? -1) + 1,
    json: JSON.stringify({ role: 'user', content: note }),
  })
  await nextTurn(db, scheduler, run)
}

/** Puts a run on hold until its requests are decided, and wakes it when the last one expires. */
export async function wait(
  db: Db,
  scheduler: Scheduler,
  run: Run,
  approvalIds: GenericId<'approvals'>[],
) {
  if (await allDecided(db, approvalIds)) return resume(db, scheduler, run, approvalIds)
  await db.patch(run._id, { status: 'waiting', approvalIds, stepAt: Date.now() })
  let last = 0
  for (const id of approvalIds) last = Math.max(last, (await db.get(id))?.expiresAt ?? 0)
  // The wake-up runs the step, which sees a waiting run and asks `wake`; a decision before then wakes it first.
  await scheduler.runAt(last + 1000, makeFunctionReference<'action'>(run.step), {
    runId: run._id,
    turn: run.turn,
    wake: true,
  })
}

/** Ends a run, and cancels every request it still has open: nobody is left to act on the decision. */
export async function finish(
  db: Db,
  run: Run,
  outcome:
    | { status: 'done'; answer: string }
    | { status: 'failed'; error: { code: string; message: string } },
) {
  await db.patch(run._id, { ...outcome, approvalIds: undefined, stepAt: Date.now() })
  await cancelRequests(
    db,
    `app:${run.userId}:${run.agent}`,
    (row) => row.caller.door === 'app' && row.caller.runId === run._id,
  )
}

/** Cancels the open requests of one agent (its actor key), optionally only some. */
export async function cancelRequests(
  db: Db,
  requesterKey: string,
  which: (row: LibraryDataModel['approvals']['document']) => boolean = () => true,
) {
  const open = await db
    .query('approvals')
    .withIndex('by_requester_status', (q) =>
      q.eq('requester.key', requesterKey).eq('status', 'pending'),
    )
    .take(500)
  const now = Date.now()
  for (const row of open)
    if (which(row))
      await db.patch(row._id, { status: row.expiresAt <= now ? 'expired' : 'cancelled' })
}

/** What a person sees: a run that stopped answering counts as failed. */
export function shownStatus(run: Run) {
  if (run.status === 'running' && run.stepAt < Date.now() - stallAfter) {
    return { status: 'failed' as const, error: stalled }
  }
  return { status: run.status, error: run.error }
}

export const stalled = {
  code: 'STALLED',
  message: 'The agent stopped responding. Start it again; anything it did before is kept.',
}
