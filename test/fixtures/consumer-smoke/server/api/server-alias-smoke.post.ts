import { api } from '#convex/api'
import { serverConvex } from '#convex/server'

export default defineEventHandler(async (event) => {
  const caller = serverConvex(event)
  const tasks = await caller.query(api.tasks.list)
  const createdTaskId = await caller.mutation(api.tasks.create, {
    text: 'created from server alias smoke',
  })

  return {
    createdTaskId,
    taskCount: tasks.length,
  }
})

/**
 * Negative-space call-arity contracts for the server caller. These must NOT
 * compile; diverging from Convex's `OptionalRestArgs` contract makes the
 * `@ts-expect-error` lines fail `check:consumer-smoke`. Never invoked.
 */
async function _serverRequiredArgsContracts(event: Parameters<typeof serverConvex>[0]) {
  const caller = serverConvex(event)
  // Positive: an exact no-arg query omits the artificial `{}` argument.
  await caller.query(api.tasks.list)
  // Positive: Convex also permits an explicit empty args object.
  await caller.query(api.tasks.list, {})
  // Positive: correct required args compile.
  await caller.query(api.files.getUrl, { storageId: 'file_1' })
  // @ts-expect-error `{}` must not satisfy a query with required args
  await caller.query(api.files.getUrl, {})
  // @ts-expect-error wrong arg shape must not compile
  await caller.query(api.files.getUrl, { wrong: 1 })
  // @ts-expect-error required mutation args are not omittable
  await caller.mutation(api.tasks.create)
}

/**
 * Public option shapes are mutually exclusive at compile time and remain
 * validated at runtime for JavaScript and casts.
 */
function _serverOptionContracts(event: Parameters<typeof serverConvex>[0]) {
  serverConvex(event, { auth: 'none' })
  serverConvex(event, { authToken: 'jwt' })
  // @ts-expect-error an explicit token already implies required auth
  serverConvex(event, { authToken: 'jwt', auth: 'required' })
  serverConvex(event, { credential: { type: 'cookie', value: 'better-auth.session_token=k' } })
  serverConvex(event, {
    authToken: 'jwt',
    // @ts-expect-error token and credential are mutually exclusive
    credential: { type: 'cookie', value: 'better-auth.session_token=k' },
  })
  serverConvex(event, {
    auth: 'required',
    // @ts-expect-error an explicit credential already implies required auth
    credential: { type: 'cookie', value: 'better-auth.session_token=k' },
  })
  // @ts-expect-error Better Auth session tokens are not public bearer credentials
  serverConvex(event, { credential: { type: 'bearer', value: 'k' } })
}
