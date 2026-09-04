import { defineRequestState, tryGetCurrentAuthEndpointContext } from '@better-auth/core/context'

import type { WorkforceConsumedChallenge, WorkforceOperation } from './operations'

type EndpointContext = NonNullable<ReturnType<typeof tryGetCurrentAuthEndpointContext>>['context']
type OperationBinding = {
  operation: Readonly<Exclude<WorkforceOperation, { operation: 'password-challenge' }>>
  passwordChallengeReserved?: true
  // undefined: never armed; receipt: available; null: permanently spent/invalid.
  consumedChallenge?: Readonly<WorkforceConsumedChallenge> | null
}
const operationBindings = defineRequestState(() => new WeakMap<EndpointContext, OperationBinding>())

function currentContext(): EndpointContext | null {
  return tryGetCurrentAuthEndpointContext()?.context ?? null
}

async function bindingFor(context: EndpointContext): Promise<OperationBinding | null> {
  return (await operationBindings.get()).get(context) ?? null
}

/** Bind server-established evidence once, before the provider verifies credentials. */
export async function setWorkforceOperation(operation: WorkforceOperation): Promise<void> {
  if (operation.operation === 'password-challenge') {
    throw new Error('AUTH_WORKFORCE_DERIVED_OPERATION_FORBIDDEN')
  }
  const context = currentContext()
  if (!context) throw new Error('AUTH_WORKFORCE_CONTEXT_REQUIRED')
  const bindings = await operationBindings.get()
  if (bindings.has(context)) throw new Error('AUTH_WORKFORCE_OPERATION_ALREADY_BOUND')
  const ownedOperation = { ...operation }
  if ('replay' in ownedOperation && ownedOperation.replay) {
    ownedOperation.replay = {
      ...ownedOperation.replay,
      matchingCounters: [...ownedOperation.replay.matchingCounters],
    }
    Object.freeze(ownedOperation.replay.matchingCounters)
    Object.freeze(ownedOperation.replay)
  }
  // Nested endpoints share Better Auth's request state, so bind authority to
  // the exact endpoint-owned auth context rather than the whole request.
  bindings.set(context, { operation: Object.freeze(ownedOperation) })
}

/** Reserve the first primary create before dispatch, retaining the password snapshot. */
export async function reserveWorkforcePasswordChallenge(row: {
  id?: unknown
  value?: unknown
}): Promise<Extract<WorkforceOperation, { operation: 'password-challenge' }> | null> {
  const context = currentContext()
  const binding = context && (await bindingFor(context))
  const operation = binding?.operation
  if (
    !binding ||
    operation?.operation !== 'password-sign-in' ||
    binding.passwordChallengeReserved ||
    row.value !== operation.userId
  )
    return null
  if (
    typeof row.id !== 'string' ||
    !row.id ||
    row.id.trim() !== row.id ||
    !operation.userId ||
    operation.userId.trim() !== operation.userId ||
    !Number.isSafeInteger(operation.expectedGeneration) ||
    operation.expectedGeneration < 0
  )
    throw new Error('AUTH_WORKFORCE_PASSWORD_CHALLENGE_INVALID')
  // No await or rollback between reservation and returning the derived operation.
  // In particular, user.id="0" must not stamp the later attempts row value="0".
  binding.passwordChallengeReserved = true
  return Object.freeze({
    ...operation,
    operation: 'password-challenge',
    challengeId: row.id,
  })
}

/** Transient metadata only; the component mutation must revalidate canonical state. */
export async function getWorkforceOperation(): Promise<OperationBinding['operation'] | null> {
  const context = currentContext()
  return context ? ((await bindingFor(context))?.operation ?? null) : null
}

/** Relay only a provider-created restricted successor, never change assurance or generation. */
export async function relayWorkforceSession(session: {
  id: string
  userId: string
}): Promise<void> {
  const context = currentContext()
  if (!context) throw new Error('AUTH_WORKFORCE_CONTEXT_REQUIRED')
  const binding = await bindingFor(context)
  const operation = binding?.operation
  if (
    operation?.operation !== 'confirm-enrollment' ||
    operation.userId !== session.userId ||
    session.id.trim().length === 0
  ) {
    throw new Error('AUTH_WORKFORCE_RELAY_INVALID')
  }
  binding.operation = Object.freeze({ ...operation, sessionId: session.id })
}

/** Called only with the canonical adapter consumeOne return, never a pre-read snapshot. */
export async function armWorkforceConsumedChallenge(
  row: Readonly<Record<string, unknown>> | null,
): Promise<void> {
  const context = currentContext()
  const binding = context && (await bindingFor(context))
  const operation = binding?.operation
  if (
    !binding ||
    !row ||
    (operation?.operation !== 'totp-sign-in' && operation?.operation !== 'recovery-sign-in') ||
    row.id !== operation.challengeId
  )
    return
  if (binding.consumedChallenge !== undefined) {
    throw new Error('AUTH_WORKFORCE_CHALLENGE_ALREADY_RECORDED')
  }
  // Burn the slot even on malformed primary data: a retry cannot repair evidence.
  binding.consumedChallenge = null
  if (
    !operation.userId ||
    !operation.challengeId ||
    row.value !== operation.userId ||
    !Number.isSafeInteger(operation.expectedGeneration) ||
    operation.expectedGeneration < 0 ||
    row.bcnAssuranceGeneration !== operation.expectedGeneration ||
    typeof row.expiresAt !== 'number' ||
    !Number.isSafeInteger(row.expiresAt) ||
    row.expiresAt <= 0 ||
    row.expiresAt <= Date.now()
  )
    throw new Error('AUTH_WORKFORCE_CONSUMED_CHALLENGE_INVALID')
  binding.consumedChallenge = Object.freeze({
    operation: operation.operation,
    challengeId: operation.challengeId,
    userId: operation.userId,
    expectedGeneration: operation.expectedGeneration,
    expiresAt: row.expiresAt,
  })
}

/** Take before awaiting a final session insert; failures never restore the receipt. */
export async function takeWorkforceConsumedChallenge(
  userId: string,
): Promise<Readonly<WorkforceConsumedChallenge> | null> {
  const context = currentContext()
  const binding = context && (await bindingFor(context))
  const operation = binding?.operation
  if (
    !binding ||
    (operation?.operation !== 'totp-sign-in' && operation?.operation !== 'recovery-sign-in')
  )
    return null
  const receipt = binding.consumedChallenge
  binding.consumedChallenge = null
  if (
    !receipt ||
    receipt.userId !== userId ||
    receipt.userId !== operation.userId ||
    receipt.operation !== operation.operation ||
    receipt.challengeId !== operation.challengeId ||
    receipt.expectedGeneration !== operation.expectedGeneration ||
    receipt.expiresAt <= Date.now()
  )
    throw new Error('AUTH_WORKFORCE_CHALLENGE_RECEIPT_REQUIRED')
  return receipt
}
