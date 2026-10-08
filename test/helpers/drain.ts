import { makeFunctionReference } from 'convex/server'
import { vi } from 'vitest'

/**
 * The part of convex-test's `t` that `drain` uses. `any`: the helper serves every app's schema,
 * so it cannot name one data model.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
interface Drainable {
  run<R>(fn: (ctx: any) => Promise<R>): Promise<R>
  mutation(ref: any, args: any): Promise<unknown>
  finishInProgressScheduledFunctions(): Promise<void>
}
/* eslint-enable @typescript-eslint/no-explicit-any */

interface Job {
  _id: string
  name: string
  args: unknown[]
  state: { kind: 'pending' | 'inProgress' | 'success' | 'failed' | 'canceled' }
}

/** Jobs `only` already called, per `t`, so a second drain does not call them again. */
const called = new WeakMap<object, Set<string>>()

const jobsOf = (t: Drainable): Promise<Job[]> =>
  t.run((ctx) => ctx.db.system.query('_scheduled_functions').collect())

/**
 * Runs scheduled functions one step at a time until none is left, as the scheduler would. A step
 * is one scheduled function. Fails when more than `maxSteps` ran (a loop
 * that makes no progress, or a job that needs more steps than it should), and when a scheduled function failed (convex-test only logs that).
 * Pick `maxSteps` from the work, a little above what it needs, so a regression shows as a failure.
 *
 * Without `only`: needs `vi.useFakeTimers()`; fires every scheduled function, whatever its name.
 * With `only` (a function name such as `'tools:housekeeping'`): calls just the pending jobs of that
 * function, once each, and leaves other scheduled functions pending (a woken agent run must not
 * start). An error in such a step is thrown. Returns the steps run and, with `only`, their arguments.
 */
export async function drain(t: Drainable, { maxSteps, only }: { maxSteps: number; only?: string }) {
  const tooMany = (steps: number, left: number) =>
    new Error(
      `drain: ${left} scheduled function(s) still pending after ${steps} steps, more than maxSteps ${maxSteps}. A step that schedules itself without making progress?`,
    )
  if (only) {
    const ran = called.get(t) ?? new Set<string>()
    called.set(t, ran)
    const args: unknown[] = []
    for (;;) {
      const job = (await jobsOf(t)).find((job) => job.name === only && !ran.has(job._id))
      if (!job) return { steps: args.length, args }
      if (args.length >= maxSteps) throw tooMany(args.length, 1)
      ran.add(job._id)
      args.push(job.args[0])
      await t.mutation(makeFunctionReference<'mutation'>(only), job.args[0])
    }
  }
  if (!vi.isFakeTimers()) throw new Error('drain: call vi.useFakeTimers() first, or pass `only`.')
  const finished = async () =>
    (await jobsOf(t)).filter((job) => job.state.kind === 'success').length
  const before = await finished()
  for (let round = 0; ; round++) {
    vi.runOnlyPendingTimers()
    await t.finishInProgressScheduledFunctions()
    const jobs = await jobsOf(t)
    const failed = jobs.filter((job) => job.state.kind === 'failed')
    if (failed.length)
      throw new Error(
        `drain: ${failed.length} scheduled function(s) failed: ${failed.map((job) => job.name).join(', ')} (convex-test logged the error)`,
      )
    const steps = jobs.filter((job) => job.state.kind === 'success').length - before
    const left = jobs.filter(({ state }) => state.kind === 'pending' || state.kind === 'inProgress')
    if (steps > maxSteps || round > maxSteps) throw tooMany(steps, left.length)
    if (!left.length) return { steps, args: [] as unknown[] }
  }
}
