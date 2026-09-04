import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { BaseConvexClient, ConvexHttpClient } from 'convex/browser'

const admissionGuardSourceCommit = '44f7aa7f7ffc35ac56d8fada8e864aecb03f27f8'

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

export function isComponentAdmissionDenied(error) {
  const message = error instanceof Error ? error.message : String(error)
  return /component.*(?:admin|auth)|(?:admin|auth).*component|unauthenticated|unauthorized|not authenticated|not authorized|BadDeployKey|provided deploy key was invalid/iu.test(
    message,
  )
}

export function isRootAdmissionMissing(error) {
  const message = error instanceof Error ? error.message : String(error)
  return /could not find public function|not a public function/iu.test(message)
}

export function isInconclusiveComponentSocketClose(error) {
  const message = error instanceof Error ? error.message : String(error)
  return /closed with code 1011\b.+internal(?:servererror| server error)/iu.test(message)
}

export function hasCompleteSessionAdmissionBoundaryEvidence(evidence) {
  return (
    evidence.httpPassed === true &&
    evidence.rootPublicQueryMissing === true &&
    evidence.adminCanaryPassed === true &&
    evidence.wsAdminCanaryPassed === true &&
    evidence.wsRootBeforePassed === true &&
    evidence.wsRootAfterPassed === true &&
    evidence.adminCanaryAfterPassed === true &&
    evidence.reviewedGuardMatchesBackend === true &&
    (evidence.ws === 'denied' || evidence.ws === 'inconclusive')
  )
}

async function requireWebSocketControl(url, path, args, accepts, options = {}) {
  let client
  let subscription
  let timer
  try {
    return await new Promise((resolveProof, reject) => {
      const fail = () => reject(new Error('AUTH_ADMISSION_WS_CONTROL_FAILED'))
      client = new BaseConvexClient(
        url,
        (tokens) => {
          if (!subscription || !tokens.includes(subscription.queryToken)) return
          try {
            const result = client.localQueryResultByToken(subscription.queryToken)
            if (result === undefined) return
            if (accepts(result)) resolveProof(true)
            else fail()
          } catch {
            fail()
          }
        },
        { logger: false, onServerDisconnectError: fail },
      )
      if (options.adminKey) client.setAdminAuth(options.adminKey)
      timer = setTimeout(fail, 15_000)
      subscription = client.subscribe(path, args, {
        componentPath: options.componentPath,
      })
    })
  } finally {
    clearTimeout(timer)
    subscription?.unsubscribe()
    await client?.close()
  }
}

async function requireDenied(invoke, classify, failure) {
  try {
    await invoke()
  } catch (error) {
    assert(
      classify(error),
      `${failure}:${isRootAdmissionMissing(error) ? 'PUBLIC_FUNCTION_UNAVAILABLE' : 'UNEXPECTED_ERROR'}`,
    )
    return
  }
  throw new Error(`${failure}:UNEXPECTED_SUCCESS`)
}

async function observeWebSocketComponentBoundary(url, args, componentPath) {
  let client
  let subscription
  let timer
  try {
    return await new Promise((resolveProof, reject) => {
      const denied = (error) => {
        if (isComponentAdmissionDenied(error) || isRootAdmissionMissing(error)) {
          resolveProof('denied')
        } else if (isInconclusiveComponentSocketClose(error)) {
          resolveProof('inconclusive')
        } else {
          reject(new Error('AUTH_ADMISSION_WS_UNEXPECTED_ERROR'))
        }
      }
      client = new BaseConvexClient(
        url,
        (tokens) => {
          if (!subscription || !tokens.includes(subscription.queryToken)) return
          try {
            const result = client.localQueryResultByToken(subscription.queryToken)
            if (result !== undefined) {
              reject(new Error('AUTH_ADMISSION_WS_UNEXPECTED_SUCCESS'))
            }
          } catch (error) {
            denied(error)
          }
        },
        { logger: false, onServerDisconnectError: denied },
      )
      timer = setTimeout(() => reject(new Error('AUTH_ADMISSION_WS_TIMEOUT')), 15_000)
      subscription = client.subscribe('adapter:sessionAdmission', args, {
        componentPath,
      })
    })
  } finally {
    clearTimeout(timer)
    subscription?.unsubscribe()
    await client?.close()
  }
}

/**
 * Prove that session admission is callable by the component transport only.
 * The pinned backend guard was reviewed at the commit recorded above; a masked
 * WebSocket close is accepted only when all independent controls also pass.
 */
export async function verifySessionAdmissionBoundary({
  url,
  adminClient,
  adminKey,
  root,
  componentFunctions,
  componentPath,
}) {
  const suffix = randomUUID()
  const args = {
    sessionId: `bcn-boundary-session-${suffix}`,
    userId: `bcn-boundary-user-${suffix}`,
  }
  const canaryToken = `synthetic-not-provider-issued-${suffix}`
  const now = Date.now()
  const backend = JSON.parse(readFileSync(join(root, 'security/local-convex-backend.json'), 'utf8'))
  const reviewedGuardMatchesBackend = backend.backendVersion.endsWith(
    `-${admissionGuardSourceCommit.slice(0, 7)}`,
  )
  assert(reviewedGuardMatchesBackend, 'AUTH_ADMISSION_PROTOCOL_SOURCE_REVIEW_REQUIRED')
  const acceptsCanary = (value) =>
    value?.session?.id === args.sessionId &&
    value.session.userId === args.userId &&
    value.session.token === canaryToken &&
    value.user?.id === args.userId
  const readCanary = async () =>
    acceptsCanary(
      await adminClient.function(componentFunctions.sessionAdmission, componentPath, args),
    )
  try {
    await adminClient.function(componentFunctions.create, componentPath, {
      model: 'user',
      data: {
        id: args.userId,
        name: 'Synthetic boundary user',
        email: `${suffix}@example.test`,
        emailVerified: true,
        createdAt: now,
        updatedAt: now,
      },
    })
    await adminClient.function(componentFunctions.create, componentPath, {
      model: 'session',
      data: {
        id: args.sessionId,
        userId: args.userId,
        token: canaryToken,
        createdAt: now,
        updatedAt: now,
        expiresAt: now + 300_000,
      },
    })
    const adminCanaryPassed = await readCanary()
    assert(adminCanaryPassed, 'AUTH_ADMISSION_COMPONENT_CONTROL_FAILED')
    const anonymousClient = new ConvexHttpClient(url, { logger: false })
    await requireDenied(
      () => anonymousClient.function(componentFunctions.sessionAdmission, componentPath, args),
      isComponentAdmissionDenied,
      'AUTH_ADMISSION_HTTP_COMPONENT_BOUNDARY',
    )
    await requireDenied(
      () => anonymousClient.query(componentFunctions.sessionAdmission, args),
      isRootAdmissionMissing,
      'AUTH_ADMISSION_ROOT_PUBLIC_BOUNDARY',
    )
    const wsAdminCanaryPassed = await requireWebSocketControl(
      url,
      'adapter:sessionAdmission',
      args,
      acceptsCanary,
      { adminKey, componentPath },
    )
    const rootControl = () =>
      requireWebSocketControl(url, 'auth:getPermissionContext', {}, (value) => value === null)
    const wsRootBeforePassed = await rootControl()
    const ws = await observeWebSocketComponentBoundary(url, args, componentPath)
    const wsRootAfterPassed = await rootControl()
    const adminCanaryAfterPassed = await readCanary()
    const evidence = {
      httpPassed: true,
      rootPublicQueryMissing: true,
      adminCanaryPassed,
      wsAdminCanaryPassed,
      wsRootBeforePassed,
      wsRootAfterPassed,
      adminCanaryAfterPassed,
      reviewedGuardMatchesBackend,
      ws,
    }
    assert(
      hasCompleteSessionAdmissionBoundaryEvidence(evidence),
      'AUTH_ADMISSION_BOUNDARY_EVIDENCE_INCOMPLETE',
    )
    return { ...evidence, wsBoundaryPassed: true }
  } finally {
    await adminClient.function(componentFunctions.remove, componentPath, {
      model: 'session',
      where: [{ field: 'id', value: args.sessionId }],
    })
    await adminClient.function(componentFunctions.remove, componentPath, {
      model: 'user',
      where: [{ field: 'id', value: args.userId }],
    })
  }
}
