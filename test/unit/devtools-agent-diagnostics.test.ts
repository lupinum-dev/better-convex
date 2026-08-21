import { describe, expect, it } from 'vitest'

import type { AuthProxyRequest } from '../../src/runtime/devtools/types'
import { agentDiagnosticOutcome } from '../../src/runtime/devtools/ui/agent-diagnostics'

function request(status: number, success: boolean): AuthProxyRequest {
  return { id: 'request', method: 'GET', path: '/oauth/authorize', status, success, timestamp: 0 }
}

describe('agent DevTools diagnostics', () => {
  it('reports OAuth navigation as a redirect instead of a failure', () => {
    expect(agentDiagnosticOutcome(request(302, false))).toEqual({
      badge: 'pending',
      label: 'redirected',
    })
  })

  it('distinguishes allowed and denied proxy decisions', () => {
    expect(agentDiagnosticOutcome(request(200, true)).label).toBe('allowed')
    expect(agentDiagnosticOutcome(request(401, false)).label).toBe('denied or failed')
  })
})
