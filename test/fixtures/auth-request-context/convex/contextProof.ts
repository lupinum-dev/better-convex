import { betterAuth } from 'better-auth'
import { memoryAdapter } from 'better-auth/adapters/memory'
import { createAuthEndpoint, createAuthMiddleware } from 'better-auth/api'

import type { WorkforceOperation } from '../../../../src/runtime/convex-auth/workforce/operations'
import {
  getWorkforceOperation,
  relayWorkforceSession,
  setWorkforceOperation,
} from '../../../../src/runtime/convex-auth/workforce/request-context'

type EnrollmentOperation = Extract<WorkforceOperation, { sessionId: string }>

const first: EnrollmentOperation = {
  operation: 'confirm-enrollment',
  userId: 'context-first-user',
  sessionId: 'context-first-original-session',
  expectedGeneration: 3,
}
const second: EnrollmentOperation = {
  operation: 'confirm-enrollment',
  userId: 'context-second-user',
  sessionId: 'context-second-original-session',
  expectedGeneration: 7,
}

function requireProof(condition: unknown, stage: string): asserts condition {
  if (!condition) throw new Error(`AUTH_REQUEST_CONTEXT_PROOF_FAILED:${stage}`)
}

async function requireOperation(expected: EnrollmentOperation, sessionId = expected.sessionId) {
  const actual = await getWorkforceOperation()
  requireProof(
    actual?.operation === expected.operation &&
      actual.userId === expected.userId &&
      actual.sessionId === sessionId &&
      actual.expectedGeneration === expected.expectedGeneration,
    'binding',
  )
}

// Runs in the default Convex action runtime. Memory persistence is intentional:
// this proves provider context propagation, not the component's durable lifecycle.
export async function proveWorkforceRequestContext() {
  requireProof((await getWorkforceOperation()) === null, 'outside-before')
  let outsideWriteRejected = false
  try {
    await setWorkforceOperation(first)
  } catch (error) {
    outsideWriteRejected =
      error instanceof Error && error.message === 'AUTH_WORKFORCE_CONTEXT_REQUIRED'
  }
  requireProof(outsideWriteRejected, 'outside-write')

  const counts = { before: 0, adapter: 0, sessionAfter: 0, endpointAfter: 0, blank: 0 }
  let release: () => void = () => {}
  const rendezvous = new Promise<void>((resolve) => {
    release = resolve
  })
  const factory = memoryAdapter({ session: [] })
  const observedFactory: typeof factory = (options) => {
    const adapter = factory(options)
    return {
      ...adapter,
      create: async (input) => {
        if (input.model === 'session') {
          const expected = input.data.userId === first.userId ? first : second
          requireProof(input.data.userId === expected.userId, 'adapter-user')
          await requireOperation(expected)
          counts.adapter += 1
          if (counts.adapter === 2) release()
          await rendezvous
          await requireOperation(expected)
        }
        return adapter.create(input)
      },
    }
  }
  const origin = 'https://context-proof.example.test'
  const endpoint = (path: string, operation?: EnrollmentOperation) =>
    createAuthEndpoint(path, { method: 'POST' }, async (ctx) => {
      if (!operation) {
        requireProof((await getWorkforceOperation()) === null, 'blank-endpoint')
        counts.blank += 1
      } else {
        await requireOperation(operation)
        const session = await ctx.context.internalAdapter.createSession(operation.userId)
        requireProof(session !== null, 'session-created')
        await requireOperation(operation, session.id)
        counts.endpointAfter += 1
      }
      return ctx.json({ ok: true })
    })
  const auth = betterAuth({
    baseURL: origin,
    secret: 'synthetic-convex-context-proof-secret-more-than-32-characters',
    database: observedFactory,
    logger: { disabled: true },
    hooks: {
      before: createAuthMiddleware(async (ctx) => {
        const expected =
          ctx.path === '/context-first' ? first : ctx.path === '/context-second' ? second : null
        requireProof((await getWorkforceOperation()) === null, 'before-unbound')
        if (expected) {
          await setWorkforceOperation(expected)
          await requireOperation(expected)
          counts.before += 1
        }
      }),
    },
    databaseHooks: {
      session: {
        create: {
          after: async (session) => {
            const expected = session.userId === first.userId ? first : second
            requireProof(session.userId === expected.userId, 'session-user')
            await requireOperation(expected)
            await relayWorkforceSession({ id: session.id, userId: session.userId })
            await requireOperation(expected, session.id)
            counts.sessionAfter += 1
          },
        },
      },
    },
    plugins: [
      {
        id: 'test-convex-workforce-request-context',
        endpoints: {
          first: endpoint('/context-first', first),
          second: endpoint('/context-second', second),
          blank: endpoint('/context-blank'),
        },
      },
    ],
  })
  const invoke = async (path: string) => {
    const response = await auth
      .handler(
        new Request(`${origin}/api/auth/${path}`, {
          method: 'POST',
          headers: {
            origin,
            'content-type': 'application/json',
            'x-workforce-operation': JSON.stringify(first),
          },
          body: JSON.stringify(first),
        }),
      )
      .catch(() => {
        release()
        throw new Error('AUTH_REQUEST_CONTEXT_PROOF_FAILED:handler')
      })
    // A failed request must not leave its concurrent peer waiting at the barrier.
    if (response.status !== 200) release()
    requireProof(response.status === 200, 'endpoint-status')
    requireProof((await getWorkforceOperation()) === null, 'outside-after-handler')
  }
  // The unbound request overlaps both bound requests and receives forged caller input.
  await Promise.all([invoke('context-first'), invoke('context-second'), invoke('context-blank')])
  await invoke('context-blank')
  requireProof(
    counts.before === 2 &&
      counts.adapter === 2 &&
      counts.sessionAfter === 2 &&
      counts.endpointAfter === 2 &&
      counts.blank === 2,
    'counts',
  )
  return { ...counts, outsideWriteRejected, outsideBinding: false, blankBinding: false }
}
