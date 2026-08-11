import { describe, expect, it } from 'vitest'

import { ConvexCallError } from '../../packages/vue/src/errors'
import type { ClientIdentitySnapshot } from '../../packages/vue/src/internal/identity-port'
import { decideQueryExecution } from '../../packages/vue/src/internal/query-execution'
import type { ConvexAuthMode, ConvexQueryAuthStatus } from '../../src/runtime/utils/auth-status'
import type { ConvexIdentityKey } from '../../src/runtime/utils/identity-key'
import {
  createQueryExecutionGate,
  type QueryExecutionGateInput,
} from '../../src/runtime/utils/query-execution-gate'

const USER: ConvexIdentityKey = 'user:alice'

function gate(overrides: Partial<QueryExecutionGateInput> = {}) {
  const base: QueryExecutionGateInput = {
    authStatus: 'authenticated',
    authMode: 'optional',
    identityKey: USER,
    skipped: false,
  }
  return createQueryExecutionGate({ ...base, ...overrides })
}

const MODES: ConvexAuthMode[] = ['required', 'optional', 'none']
const STATUSES: ConvexQueryAuthStatus[] = [
  'disabled',
  'loading',
  'anonymous',
  'authenticated',
  'error',
]

describe('createQueryExecutionGate', () => {
  // 1. Explicit skip resolves idle regardless of status/mode.
  describe('step 1 — explicit skip', () => {
    for (const authStatus of STATUSES) {
      for (const authMode of MODES) {
        it(`skip idles for ${authMode}/${authStatus}`, () => {
          const g = gate({ skipped: true, authStatus, authMode })
          expect(g).toMatchObject({ outcome: 'idle' })
        })
      }
    }
  })

  // 2. `none` executes without waiting, anonymous cache dimension, anonymous
  //    transport (except in an auth-disabled build where the primary is already
  //    anonymous).
  describe('step 2 — none executes anonymously without waiting', () => {
    for (const authStatus of STATUSES) {
      it(`none executes for status ${authStatus}`, () => {
        const g = gate({ authMode: 'none', authStatus, identityKey: USER })
        expect(g).toMatchObject({
          outcome: 'execute',
          cacheIdentity: 'anonymous',
        })
      })
    }

    it('none never inspects identity — authenticated key still keys anonymous', () => {
      expect(
        gate({
          authMode: 'none',
          authStatus: 'authenticated',
          identityKey: USER,
        }),
      ).toMatchObject({ cacheIdentity: 'anonymous', outcome: 'execute' })
    })
  })

  // 3. Auth disabled.
  describe('step 3 — disabled', () => {
    it('required idles under disabled', () => {
      expect(
        gate({
          authStatus: 'disabled',
          authMode: 'required',
          identityKey: null,
        }),
      ).toMatchObject({
        outcome: 'idle',
        cacheIdentity: 'anonymous',
      })
    })

    it('optional executes anonymously without waiting under disabled', () => {
      expect(
        gate({
          authStatus: 'disabled',
          authMode: 'optional',
          identityKey: null,
        }),
      ).toMatchObject({
        outcome: 'execute',
        cacheIdentity: 'anonymous',
      })
    })
  })

  // 4. Loading — both wait.
  describe('step 4 — loading waits', () => {
    for (const authMode of ['required', 'optional'] as const) {
      it(`${authMode} waits under loading`, () => {
        expect(gate({ authStatus: 'loading', authMode, identityKey: null })).toMatchObject({
          outcome: 'wait',
        })
      })
    }
  })

  // 5. Error — surface without a network request; never downgrade to anonymous.
  describe('step 5 — error surfaces without a request', () => {
    for (const authMode of ['required', 'optional'] as const) {
      it(`${authMode} surfaces auth error`, () => {
        expect(gate({ authStatus: 'error', authMode, identityKey: null })).toMatchObject({
          outcome: 'error',
        })
      })
    }
  })

  // 6. Anonymous — required idles, optional executes anonymously.
  describe('step 6 — settled anonymous', () => {
    it('required idles under anonymous', () => {
      expect(
        gate({
          authStatus: 'anonymous',
          authMode: 'required',
          identityKey: 'anonymous',
        }),
      ).toMatchObject({
        outcome: 'idle',
        cacheIdentity: 'anonymous',
      })
    })

    it('optional executes anonymously under anonymous', () => {
      expect(
        gate({
          authStatus: 'anonymous',
          authMode: 'optional',
          identityKey: 'anonymous',
        }),
      ).toMatchObject({
        outcome: 'execute',
        cacheIdentity: 'anonymous',
      })
    })
  })

  // 7. Authenticated — both execute with the concrete user identity.
  describe('step 7 — authenticated', () => {
    for (const authMode of ['required', 'optional'] as const) {
      it(`${authMode} executes with the user identity`, () => {
        expect(gate({ authStatus: 'authenticated', authMode, identityKey: USER })).toMatchObject({
          outcome: 'execute',
          cacheIdentity: USER,
        })
      })
    }

    it('defensively waits when authenticated but the identity key is not a concrete user', () => {
      // Never manufacture user:undefined . A settled-authenticated
      // status without a usable id waits rather than executing.
      expect(
        gate({
          authStatus: 'authenticated',
          authMode: 'required',
          identityKey: null,
        }),
      ).toMatchObject({
        outcome: 'wait',
        cacheIdentity: 'anonymous',
      })
      expect(
        gate({
          authStatus: 'authenticated',
          authMode: 'optional',
          identityKey: 'anonymous',
        }),
      ).toMatchObject({
        outcome: 'wait',
      })
    })
  })

  // Precedence: skip beats everything, including none/loading/error.
  describe('precedence', () => {
    it('skip beats none', () => {
      expect(gate({ skipped: true, authMode: 'none' }).outcome).toBe('idle')
    })

    it('none beats loading (does not wait for auth)', () => {
      expect(gate({ authMode: 'none', authStatus: 'loading' })).toMatchObject({
        outcome: 'execute',
      })
    })

    it('none beats error (does not surface auth error)', () => {
      expect(gate({ authMode: 'none', authStatus: 'error' })).toMatchObject({
        outcome: 'execute',
      })
    })
  })

  it('matches the client package matrix for every representable settled state', () => {
    const snapshots: Record<ConvexQueryAuthStatus, ClientIdentitySnapshot> = {
      disabled: {
        authEnabled: false,
        settled: true,
        identityKey: 'anonymous',
        identityGeneration: 0,
        error: null,
      },
      loading: {
        authEnabled: true,
        settled: false,
        identityKey: 'anonymous',
        identityGeneration: 0,
        error: null,
      },
      anonymous: {
        authEnabled: true,
        settled: true,
        identityKey: 'anonymous',
        identityGeneration: 0,
        error: null,
      },
      authenticated: {
        authEnabled: true,
        settled: true,
        identityKey: USER,
        identityGeneration: 0,
        error: null,
      },
      error: {
        authEnabled: true,
        settled: true,
        identityKey: 'anonymous',
        identityGeneration: 0,
        error: new ConvexCallError({ kind: 'authentication', message: 'auth failed' }),
      },
    }
    for (const authStatus of STATUSES) {
      for (const authMode of MODES) {
        for (const skipped of [false, true]) {
          expect(
            gate({
              authStatus,
              authMode,
              skipped,
              identityKey:
                authStatus === 'authenticated'
                  ? USER
                  : authStatus === 'disabled'
                    ? null
                    : 'anonymous',
            }).outcome,
          ).toBe(decideQueryExecution({ auth: authMode, skipped, identity: snapshots[authStatus] }))
        }
      }
    }
  })
})
