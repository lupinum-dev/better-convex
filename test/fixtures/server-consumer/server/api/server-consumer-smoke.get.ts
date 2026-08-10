import { ConvexCallError } from 'better-convex-nuxt/errors'
import { serverConvex } from 'better-convex-nuxt/server'
import { makeFunctionReference } from 'convex/server'

type ProbeOperation = 'query' | 'mutation' | 'action'
type ProbeScenario = 'success' | 'structured' | 'plain' | 'transport' | 'required-auth'
type ProbeArgs = { sentinel: string }
type ProbeResult = { operation: ProbeOperation; scenario: ProbeScenario }

const operations = new Set<ProbeOperation>(['query', 'mutation', 'action'])
const scenarios = new Set<ProbeScenario>([
  'success',
  'structured',
  'plain',
  'transport',
  'required-auth',
])
const ARGUMENT_SENTINEL = 'PACKED_SERVER_ARGUMENT_SENTINEL_63dff0c4'

/**
 * Packed declaration contracts. This function is never invoked by the runtime
 * probe; `nuxi typecheck` verifies the published `/server` types instead.
 */
async function _packedServerTypeContracts(event: Parameters<typeof serverConvex>[0]) {
  const caller = serverConvex(event)
  const noArgsQuery = makeFunctionReference<'query', Record<string, never>, string[]>(
    'serverProbe:no-args',
  )
  const requiredMutation = makeFunctionReference<'mutation', ProbeArgs, ProbeResult>(
    'serverProbe:required-args',
  )

  await caller.query(noArgsQuery)
  await caller.query(noArgsQuery, {})
  // @ts-expect-error required mutation args cannot be omitted
  await caller.mutation(requiredMutation)

  serverConvex(event, { authToken: 'jwt' })
  serverConvex(event, { credential: { type: 'cookie', value: 'better-auth.session_token=k' } })
  // @ts-expect-error an explicit token already implies required auth
  serverConvex(event, { authToken: 'jwt', auth: 'required' })
  serverConvex(event, {
    authToken: 'jwt',
    // @ts-expect-error token and credential are mutually exclusive
    credential: { type: 'cookie', value: 'better-auth.session_token=k' },
  })
}

function readProbeValue<T extends string>(value: unknown, allowed: Set<T>, label: string): T {
  if (typeof value !== 'string' || !allowed.has(value as T)) {
    throw createError({ statusCode: 400, statusMessage: `Invalid ${label}` })
  }
  return value as T
}

export default defineEventHandler(async (event) => {
  const query = getQuery(event)
  const operation = readProbeValue(query.operation, operations, 'operation')
  const scenario = readProbeValue(query.scenario, scenarios, 'scenario')
  const caller = serverConvex(event, {
    auth: scenario === 'required-auth' ? 'required' : 'none',
  })
  const args = { sentinel: ARGUMENT_SENTINEL }

  try {
    let result: ProbeResult
    switch (operation) {
      case 'query':
        result = await caller.query(
          makeFunctionReference<'query', ProbeArgs, ProbeResult>(
            `serverProbe:${operation}-${scenario}`,
          ),
          args,
        )
        break
      case 'mutation':
        result = await caller.mutation(
          makeFunctionReference<'mutation', ProbeArgs, ProbeResult>(
            `serverProbe:${operation}-${scenario}`,
          ),
          args,
        )
        break
      case 'action':
        result = await caller.action(
          makeFunctionReference<'action', ProbeArgs, ProbeResult>(
            `serverProbe:${operation}-${scenario}`,
          ),
          args,
        )
        break
    }
    return { ok: true, result }
  } catch (error) {
    if (!(error instanceof ConvexCallError)) {
      throw createError({ statusCode: 500, statusMessage: 'Unexpected server probe failure' })
    }

    // The packed probe captures the production Nitro process streams and
    // asserts that neither the raw upstream sentinel nor call arguments appear.
    console.error('[packed-server-call]', error)
    return {
      ok: false,
      operation,
      scenario,
      error: error.toJSON(),
      stringified: JSON.stringify(error),
      enumerableKeys: Object.keys(error),
    }
  }
})
