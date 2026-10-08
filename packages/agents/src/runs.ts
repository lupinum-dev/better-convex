import type { LibraryDataModel } from '@lupinum/better-convex-functions/internal'
import { makeFunctionReference, type GenericMutationCtx } from 'convex/server'
import type { GenericId } from 'convex/values'

import { within, type Budget } from './budget'

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

/**
 * A running run whose step has not saved for this long has stalled. Convex
 * ends an action after 10 minutes in the Node runtime and 30 minutes in its
 * own runtime; a step may still be working before that.
 */
export const stallAfter = 35 * 60_000

/**
 * True when every request is decided or expired; undefined when `budget` ran
 * out first. A decided request stays decided, so `known` collects the ones
 * found, and a later try reads only the rest.
 */
async function allDecided(
  db: Db,
  approvalIds: readonly string[],
  budget?: Budget,
  known?: Set<string>,
) {
  for (const id of approvalIds) {
    if (known?.has(id)) continue
    if (budget?.spent) return undefined
    const row = await db.get(id as GenericId<'approvals'>)
    if (row) budget?.count(row)
    if (row?.status === 'pending' && row.expiresAt > Date.now()) return false
    known?.add(id)
  }
  return true
}

/** Schedules the run's next turn; the step finds it `running` with this turn. */
export async function nextTurn(db: Db, scheduler: Scheduler, run: Run) {
  const turn = run.turn + 1
  await db.patch(run._id, { status: 'running', turn, stepAt: Date.now(), approvalIds: undefined })
  await scheduler.runAfter(0, makeFunctionReference<'action'>(run.step), { runId: run._id, turn })
}

/**
 * A waiting run continues once its last request is decided or expired. Called
 * on every decision and at expiry. With a `budget`, false when it ran out
 * before the run was seen to; see `allDecided` for `known`.
 */
export async function wake(
  db: Db,
  scheduler: Scheduler,
  runId: string,
  budget?: Budget,
  known?: Set<string>,
) {
  const id = db.normalizeId('agentRuns', runId)
  const run = id && (await db.get(id))
  if (run) budget?.count(run)
  if (run?.status !== 'waiting') return true
  const decided = await allDecided(db, run.approvalIds ?? [], budget, known)
  if (decided === undefined) return false
  if (decided) await resume(db, scheduler, run, run.approvalIds ?? [], budget)
  return true
}

/** Tells the model which requests were decided, then schedules the next turn. */
export async function resume(
  db: Db,
  scheduler: Scheduler,
  run: Run,
  approvalIds: readonly string[],
  budget?: Budget,
) {
  const last = await db
    .query('agentMessages')
    .withIndex('by_run', (q) => q.eq('runId', run._id))
    .order('desc')
    .first()
  if (last) budget?.count(last)
  const note = `Requests ${approvalIds.join(', ')} were decided. Check each with check_approval, then continue.`
  await db.insert('agentMessages', {
    runId: run._id,
    order: (last?.order ?? -1) + 1,
    json: JSON.stringify({ role: 'user', content: note }),
  })
  await nextTurn(db, scheduler, run)
}

/**
 * Puts a run on hold until its requests are decided, and wakes it when the last one expires. It
 * waits only on the ones of this run still open, which the run's agent has at most 20 of, so what
 * `wake` reads later is bounded however many IDs the turn passes.
 */
export async function wait(
  db: Db,
  scheduler: Scheduler,
  run: Run,
  approvalIds: GenericId<'approvals'>[],
) {
  const asked = new Set<string>(approvalIds)
  const open = (await openOf(db, run._id).take(100)).filter((row) => asked.has(row._id))
  if (!open.length) return resume(db, scheduler, run, approvalIds)
  const waitingOn = open.map((row) => row._id)
  await db.patch(run._id, { status: 'waiting', approvalIds: waitingOn, stepAt: Date.now() })
  const last = Math.max(...open.map((row) => row.expiresAt))
  // The wake-up runs the step, which sees a waiting run and asks `wake`; a decision before then wakes it first.
  await scheduler.runAt(last + 1000, makeFunctionReference<'action'>(run.step), {
    runId: run._id,
    turn: run.turn,
    wake: true,
  })
}

/**
 * Ends a run, and cancels every request it still has open: nobody is left to
 * act on the decision. The requests go first, so no request of an ended run
 * stays open. With a `budget`, false when it ran out before every request was
 * cancelled; the run is then not ended yet, and a later call goes on.
 */
export async function finish(
  db: Db,
  run: Run,
  outcome:
    | { status: 'done'; answer: string }
    | { status: 'failed'; error: { code: string; message: string } },
  budget?: Budget,
) {
  if (!(await cancelOpen(db, run._id, budget))) return false
  await db.patch(run._id, { ...outcome, approvalIds: undefined, stepAt: Date.now() })
  return true
}

/** A run's open requests. A pending request past its time is already expired; housekeeping marks it. */
const openOf = (db: Db, runId: GenericId<'agentRuns'>) =>
  db
    .query('approvals')
    .withIndex('by_run_status', (q) =>
      q.eq('caller.runId', runId).eq('status', 'pending').gt('expiresAt', Date.now()),
    )

/** Cancels the open requests of a run; with a `budget`, false when some remain. */
export async function cancelOpen(db: Db, runId: GenericId<'agentRuns'>, budget?: Budget) {
  const open = openOf(db, runId)
  // An agent has at most 20 open requests, so one read finds all of this run's.
  const { rows, more } = budget
    ? await within(open, budget)
    : { rows: await open.take(100), more: false }
  for (const row of rows) await db.patch(row._id, { status: 'cancelled' })
  return !more
}

/**
 * Cancels the open requests of one agent (its actor key), optionally only some. A pending request
 * past its time is left for housekeeping to mark expired: those are not limited to 20, and readers
 * already see them as expired.
 */
export async function cancelRequests(
  db: Db,
  requesterKey: string,
  which: (row: LibraryDataModel['approvals']['document']) => boolean = () => true,
) {
  const open = await db
    .query('approvals')
    .withIndex('by_requester_status', (q) =>
      q.eq('requester.key', requesterKey).eq('status', 'pending').gt('expiresAt', Date.now()),
    )
    .take(100)
  for (const row of open) if (which(row)) await db.patch(row._id, { status: 'cancelled' })
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
