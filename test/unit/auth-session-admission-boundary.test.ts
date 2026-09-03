import { describe, expect, it } from 'vitest'

import {
  hasCompleteSessionAdmissionBoundaryEvidence,
  isComponentAdmissionDenied,
  isInconclusiveComponentSocketClose,
  isRootAdmissionMissing,
} from '../../scripts/run-auth-concurrency.mjs'

describe('session admission runtime boundary failure classification', () => {
  const completeEvidence = {
    httpPassed: true,
    rootPublicQueryMissing: true,
    adminCanaryPassed: true,
    wsAdminCanaryPassed: true,
    wsRootBeforePassed: true,
    wsRootAfterPassed: true,
    adminCanaryAfterPassed: true,
    reviewedGuardMatchesBackend: true,
    ws: 'inconclusive',
  }

  it('requires source-bound guard review and every positive control, not a close alone', () => {
    expect(hasCompleteSessionAdmissionBoundaryEvidence({ ws: 'inconclusive' })).toBe(false)
    expect(hasCompleteSessionAdmissionBoundaryEvidence(completeEvidence)).toBe(true)
    for (const field of Object.keys(completeEvidence)) {
      expect(
        hasCompleteSessionAdmissionBoundaryEvidence({ ...completeEvidence, [field]: false }),
      ).toBe(false)
    }
    expect(
      hasCompleteSessionAdmissionBoundaryEvidence({ ...completeEvidence, ws: 'timeout' }),
    ).toBe(false)
    expect(
      hasCompleteSessionAdmissionBoundaryEvidence({ ...completeEvidence, ws: 'success' }),
    ).toBe(false)
  })
  it('accepts component authorization denial, not missing functions or transport failures', () => {
    expect(isComponentAdmissionDenied(new Error('BadDeployKey'))).toBe(true)
    expect(
      isComponentAdmissionDenied(new Error('Component calls require admin authentication')),
    ).toBe(true)
    expect(isComponentAdmissionDenied(new Error('Could not find public function'))).toBe(false)
    expect(isComponentAdmissionDenied(new Error('fetch failed'))).toBe(false)
    expect(isComponentAdmissionDenied(new Error('connection closed'))).toBe(false)
  })

  it('requires a missing public function for the root negative control', () => {
    expect(isRootAdmissionMissing(new Error('Could not find public function'))).toBe(true)
    expect(isRootAdmissionMissing(new Error('Unauthorized'))).toBe(false)
    expect(isRootAdmissionMissing(new Error('fetch failed'))).toBe(false)
  })

  it('records the pinned server close as inconclusive, never as auth denial', () => {
    const error = new Error('WebSocket closed with code 1011: InternalServerError')
    expect(isInconclusiveComponentSocketClose(error)).toBe(true)
    expect(isComponentAdmissionDenied(error)).toBe(false)
    expect(isRootAdmissionMissing(error)).toBe(false)
    expect(isInconclusiveComponentSocketClose(new Error('WebSocket closed with code 1006'))).toBe(
      false,
    )
    expect(isInconclusiveComponentSocketClose(new Error('fetch failed'))).toBe(false)
  })
})
