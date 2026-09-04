import type { WorkforceConsumedChallenge, WorkforceOperation } from './operations'
import {
  armWorkforceConsumedChallenge,
  getWorkforceOperation,
  reserveWorkforcePasswordChallenge,
  takeWorkforceConsumedChallenge,
} from './request-context'

interface CreateEvidence {
  operation: WorkforceOperation | null
  consumedChallenge: Readonly<WorkforceConsumedChallenge> | null
}

/** Keep workforce request evidence out of the generic Better Auth CRUD adapter. */
export function createWorkforceAdapterTransport(enabled: boolean) {
  return {
    async create(model: string, data: Record<string, unknown>): Promise<CreateEvidence> {
      if (!enabled) return { operation: null, consumedChallenge: null }
      const operation =
        model === 'verification'
          ? await reserveWorkforcePasswordChallenge(data)
          : await getWorkforceOperation()
      if (
        model !== 'session' ||
        (operation?.operation !== 'totp-sign-in' && operation?.operation !== 'recovery-sign-in')
      ) {
        return { operation, consumedChallenge: null }
      }
      if (typeof data.userId !== 'string') {
        throw new TypeError('AUTH_WORKFORCE_SESSION_OWNER_REQUIRED')
      }
      return {
        operation,
        consumedChallenge: await takeWorkforceConsumedChallenge(data.userId),
      }
    },

    operation(model?: string) {
      if (!enabled || (model !== undefined && model !== 'twoFactor')) return null
      return getWorkforceOperation()
    },

    async consumed(model: string, row: Readonly<Record<string, unknown>> | null) {
      if (enabled && model === 'verification') await armWorkforceConsumedChallenge(row)
    },
  }
}
